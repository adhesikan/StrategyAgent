// /opportunities/today — All Ranked Opportunities
//
// Dedicated full-view page for today's ranked opportunity list.
// Fixes Sprint 2.6.3 routing collision: this static route must be registered
// BEFORE /opportunities/:symbol so "today" is never treated as a ticker symbol.
//
// Data: GET /api/opportunities/today (same endpoint used by dashboard + research hub)
// Each symbol links to /opportunities/:symbol (Opportunity Workspace v2).
// Compliance: no buy/sell/recommendation language. All data deterministic.

import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  TrendingUp,
  Clock,
  ChevronRight,
  BarChart2,
  Activity,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types (mirror market-research-hub.tsx shape — same API)
// ---------------------------------------------------------------------------

interface ScoredCandidate {
  symbol:          string;
  rank?:           number;
  strategy?:       string;
  whySelected?:    string[];
  warnings?:       string[];
  opportunityScore?: {
    overallScore:        number;
    confidence?:         string;
    technicalScore?:     number;
    institutionalScore?: number;
  };
}

interface TodayRankingResponse {
  ranking: {
    generatedAt: string;
    regime:      string | null;
    topGrowth:   ScoredCandidate[];
    topIncome:   ScoredCandidate[];
    watchlist:   ScoredCandidate[];
    approaching: ScoredCandidate[];
    changes:     unknown[];
  } | null;
  available: boolean;
  message:   string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatFreshness(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 2)  return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return "";
  }
}

function scoreBadgeColor(score: number): string {
  if (score >= 80) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
  if (score >= 60) return "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30";
  if (score >= 40) return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30";
  return "bg-muted text-muted-foreground border-border";
}

// ---------------------------------------------------------------------------
// Symbol row
// ---------------------------------------------------------------------------

function SymbolRow({ c, rank }: { c: ScoredCandidate; rank?: number }) {
  const score = c.opportunityScore?.overallScore;
  return (
    <Link href={`/opportunities/${c.symbol}`}>
      <div className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/60 cursor-pointer group transition-colors">
        {rank != null && (
          <span className="text-xs text-muted-foreground w-5 text-right tabular-nums shrink-0">{rank}</span>
        )}
        <span className="font-mono text-sm font-semibold group-hover:text-primary flex-1">{c.symbol}</span>
        {c.strategy && (
          <span className="text-[10px] text-muted-foreground hidden sm:block">{c.strategy}</span>
        )}
        {score != null && (
          <span className={cn(
            "text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded border",
            scoreBadgeColor(score),
          )}>
            {score}
          </span>
        )}
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary shrink-0" />
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Section card
// ---------------------------------------------------------------------------

function BucketSection({
  title,
  icon: Icon,
  items,
  emptyText,
  compact = false,
}: {
  title:     string;
  icon:      React.ElementType;
  items:     ScoredCandidate[];
  emptyText: string;
  compact?:  boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5 text-primary" />
          {title}
          <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className={cn("px-4 pb-4", compact ? "space-y-0" : "space-y-0.5")}>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">{emptyText}</p>
        ) : compact ? (
          <div className="flex flex-wrap gap-1.5">
            {items.map(c => (
              <Link key={c.symbol} href={`/opportunities/${c.symbol}`}>
                <span className="text-xs px-2.5 py-1 bg-muted hover:bg-muted/80 rounded font-mono cursor-pointer transition-colors">
                  {c.symbol}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          items.map((c, i) => <SymbolRow key={c.symbol} c={c} rank={c.rank ?? i + 1} />)
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function OpportunityTodayPage() {
  const [, setLocation] = useLocation();

  const { data, isPending, isError } = useQuery<TodayRankingResponse>({
    queryKey: ["/api/opportunities/today"],
    staleTime: 5 * 60 * 1000,
  });

  const ranking = data?.ranking;
  const freshness = ranking?.generatedAt;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-14 z-30 bg-background/95 backdrop-blur-sm border-b border-border/60">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-muted-foreground hover:text-foreground"
              onClick={() => setLocation("/research")}
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1" />
              Research Hub
            </Button>
            <span className="text-muted-foreground/40 hidden sm:block">·</span>
            <h1 className="text-sm font-semibold hidden sm:block">All Ranked Opportunities</h1>
          </div>
          {freshness && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Updated {formatFreshness(freshness)}
            </span>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">

        {/* Page title */}
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            Today's Ranked Opportunities
          </h2>
          {ranking?.regime && (
            <p className="text-sm text-muted-foreground mt-0.5">
              Market Regime: <span className="font-medium">{ranking.regime}</span>
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            Rankings are research signals only. This is not investment advice.
          </p>
        </div>

        {/* Loading */}
        {isPending && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardHeader className="pb-2"><Skeleton className="h-4 w-32" /></CardHeader>
                <CardContent className="space-y-2 pb-4">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <Skeleton key={j} className="h-9 rounded-lg" />
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Error */}
        {isError && !isPending && (
          <Card className="border-destructive/30">
            <CardContent className="py-8 text-center space-y-2">
              <AlertCircle className="w-6 h-6 text-destructive/60 mx-auto" />
              <p className="text-sm text-muted-foreground">Could not load ranking data.</p>
              <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Not available yet */}
        {!isPending && !isError && (!data?.available || !ranking) && (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center space-y-2">
              <TrendingUp className="w-7 h-7 text-muted-foreground/30 mx-auto" />
              <p className="text-sm font-medium text-muted-foreground">Rankings not yet available</p>
              <p className="text-xs text-muted-foreground/70">
                {data?.message ?? "Waiting for the first scan cycle to complete"}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Ranking buckets */}
        {!isPending && !isError && ranking && (
          <>
            {ranking.topGrowth.length > 0 && (
              <BucketSection
                title="Top Growth Opportunities"
                icon={TrendingUp}
                items={ranking.topGrowth}
                emptyText="No growth opportunities ranked in this cycle"
              />
            )}

            {ranking.topIncome.length > 0 && (
              <BucketSection
                title="Income Opportunities"
                icon={BarChart2}
                items={ranking.topIncome}
                emptyText="No income opportunities ranked in this cycle"
              />
            )}

            {ranking.watchlist.length > 0 && (
              <BucketSection
                title="Research Watchlist"
                icon={Activity}
                items={ranking.watchlist}
                emptyText="No watchlist candidates in this cycle"
              />
            )}

            {ranking.approaching.length > 0 && (
              <BucketSection
                title="Approaching Qualification"
                icon={ChevronRight}
                items={ranking.approaching}
                emptyText="No approaching candidates"
                compact
              />
            )}

            {ranking.topGrowth.length === 0 &&
             ranking.topIncome.length === 0 &&
             ranking.watchlist.length === 0 &&
             ranking.approaching.length === 0 && (
              <Card className="border-dashed">
                <CardContent className="py-10 text-center">
                  <p className="text-sm text-muted-foreground">No ranked opportunities in this cycle.</p>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* Footer disclaimer */}
        <p className="text-[10px] text-muted-foreground text-center pb-4">
          Opportunity rankings are research signals based on technical and fundamental screening.
          They are not buy/sell recommendations, investment advice, or a prediction of future performance.
          All scores are deterministic and updated on each scan cycle.
        </p>
      </div>
    </div>
  );
}
