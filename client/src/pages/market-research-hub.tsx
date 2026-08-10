// Market Research Hub — Sprint 2.3.5
// Route: /research
//
// Unified entry point for all major research surfaces.
// Reuses existing engines and APIs — no new computation.
// COMPLIANCE: No buy/sell/recommendation language. Research evidence only.

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  Search, TrendingUp, TrendingDown, BarChart2, Layers, Building2,
  Landmark, Calendar, ChevronRight, Activity, ArrowUp, ArrowDown,
  ArrowRight, Clock, AlertCircle, Info, X, BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScoredCandidate {
  symbol:       string;
  rank?:        number;
  strategy?:    string;
  whySelected?: string[];
  warnings?:    string[];
  opportunityScore?: {
    overallScore:      number;
    confidence?:       string;
    technicalScore?:   number;
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

interface BriefingResponse {
  regime:          string | null;
  marketHealth:    number | null;
  hasData:         boolean;
  generatedAt:     string | null;
  leadingThemes:   Array<{ themeId: string; themeName: string; score: number; direction: "up"|"down"|"stable" }>;
  leadingSectors:  string[];
  mostImprovedThemes: Array<{ themeId: string; themeName: string; scoreDelta: number }>;
  mostImprovedStocks: string[];
  institutionalHighlights: {
    accumulationSignals:    number;
    newRankedOpportunities: number;
    themesStrengthened:     number;
    sectorsWeakened:        number;
  };
}

interface ChangeExplanation {
  symbol:        string;
  currentScore:  number;
  scoreDelta:    number | null;
  rankDelta:     number | null;
  importance:    "Minor"|"Moderate"|"Major"|"Critical";
  summary:       string;
  drivers:       string[];
  direction:     "upgraded"|"downgraded"|"new"|"moved"|"unchanged"|"removed";
  category:      string;
}

interface ChangesResponse {
  available:    boolean;
  generatedAt?: string;
  message?:     string;
  majorMovers:  ChangeExplanation[];
  upgrades:     ChangeExplanation[];
  downgrades:   ChangeExplanation[];
  newEntries:   ChangeExplanation[];
  removed:      ChangeExplanation[];
}

interface FundSummary {
  managerId:             string;
  managerName:           string;
  latestQuarter:         string | null;
  reportedPortfolioValue: number | null;
  reportedPositionCount: number | null;
  lastFiledAt:           string | null;
}

interface FundsResponse {
  funds:    FundSummary[];
  total:    number;
  page:     number;
  pageSize: number;
}

// ---------------------------------------------------------------------------
// Recently Viewed — localStorage
// ---------------------------------------------------------------------------

const RECENT_KEY = "vcp_research_recent";
const RECENT_MAX = 5;

export interface RecentItem {
  type:     "stock"|"theme"|"sector"|"fund";
  label:    string;
  href:     string;
  viewedAt: number;
}

export function useRecentlyViewed() {
  const [items, setItems] = useState<RecentItem[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); }
    catch { return []; }
  });

  const addItem = useCallback((item: Omit<RecentItem, "viewedAt">) => {
    setItems(prev => {
      const next = [
        { ...item, viewedAt: Date.now() },
        ...prev.filter(p => p.href !== item.href),
      ].slice(0, RECENT_MAX);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  return { items, addItem };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchResult {
  type:      "stock"|"theme"|"sector"|"fund";
  label:     string;
  sublabel?: string;
  href:      string;
}

export function buildSearchIndex(
  stocks:  string[],
  themes:  Array<{ themeId: string; themeName: string }>,
  sectors: string[],
  funds:   FundSummary[],
): SearchResult[] {
  return [
    ...stocks.map(s => ({ type: "stock" as const,  label: s, sublabel: "Stock",  href: `/opportunities/${s}` })),
    ...themes.map(t => ({ type: "theme" as const,  label: t.themeName, sublabel: "Theme", href: `/intelligence/themes/${t.themeId}` })),
    ...sectors.map(s => ({ type: "sector" as const, label: s, sublabel: "Sector", href: `/intelligence/sectors/${encodeURIComponent(s)}` })),
    ...funds.map(f => ({ type: "fund" as const, label: f.managerName, sublabel: "Fund",  href: `/institutional/funds/${f.managerId}` })),
  ];
}

export function groupSearchResults(results: SearchResult[]): Record<string, SearchResult[]> {
  const groups: Record<string, SearchResult[]> = {};
  for (const r of results) {
    const key = r.type.charAt(0).toUpperCase() + r.type.slice(1) + "s";
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }
  return groups;
}

export function runSearch(index: SearchResult[], query: string): SearchResult[] {
  const q = query.toLowerCase().trim();
  if (!q || q.length < 1) return [];
  return index
    .filter(item => item.label.toLowerCase().includes(q))
    .slice(0, 20);
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatFreshness(isoStr: string | null | undefined): string {
  if (!isoStr) return "";
  const ms = Date.now() - new Date(isoStr).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1)  return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)   return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatPortfolioValue(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6)  return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toLocaleString()}`;
}

export function directionIcon(d: "up"|"down"|"stable") {
  if (d === "up")   return <ArrowUp   className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
  if (d === "down") return <ArrowDown className="w-3.5 h-3.5 text-red-500 shrink-0" />;
  return               <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
}

export function healthColor(score: number): string {
  if (score >= 75) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 60) return "text-blue-600 dark:text-blue-400";
  if (score >= 40) return "text-yellow-600 dark:text-yellow-400";
  return "text-orange-600 dark:text-orange-400";
}

// ---------------------------------------------------------------------------
// Sub-navigation
// ---------------------------------------------------------------------------

const SUB_NAV = [
  { label: "Opportunities",   href: "/opportunities/today", icon: TrendingUp },
  { label: "Intelligence",    href: "/intelligence",         icon: Activity },
  { label: "Institutional",   href: "/institutional/funds",  icon: Building2 },
  { label: "Funds",           href: "/institutional/funds",  icon: Landmark },
  { label: "Saved Research",  href: "/research/library",     icon: BookOpen },
] as const;

// ---------------------------------------------------------------------------
// Module: Opportunities
// ---------------------------------------------------------------------------

function OpportunitiesModule({ data, onItemClick }: {
  data:        TodayRankingResponse | undefined;
  onItemClick: (item: Omit<RecentItem, "viewedAt">) => void;
}) {
  const ranking = data?.ranking;
  const isLoading = !data;
  const freshness = ranking?.generatedAt;

  const topGrowth  = ranking?.topGrowth.slice(0, 3)  ?? [];
  const topIncome  = ranking?.topIncome.slice(0, 3)   ?? [];
  const approaching = ranking?.approaching.slice(0, 2) ?? [];

  if (isLoading) return (
    <Card>
      <CardHeader className="pb-2"><Skeleton className="h-4 w-28" /></CardHeader>
      <CardContent className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 rounded" />)}</CardContent>
    </Card>
  );

  if (!data?.available || !ranking) return (
    <Card className="border-dashed">
      <CardContent className="py-8 text-center">
        <TrendingUp className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">Opportunity rankings not yet available</p>
        <p className="text-xs text-muted-foreground/60 mt-0.5">{data?.message ?? "Waiting for first scan cycle"}</p>
      </CardContent>
    </Card>
  );

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-primary" />
            Opportunities
          </CardTitle>
          {freshness && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5" />{formatFreshness(freshness)}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">

        {topGrowth.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Top Growth</p>
            <div className="space-y-1">
              {topGrowth.map(c => (
                <Link key={c.symbol} href={`/opportunities/${c.symbol}`}
                  onClick={() => onItemClick({ type: "stock", label: c.symbol, href: `/opportunities/${c.symbol}` })}>
                  <div className="flex items-center justify-between py-1 px-2 rounded hover:bg-muted/60 cursor-pointer group">
                    <span className="font-mono text-sm font-semibold group-hover:text-primary">{c.symbol}</span>
                    <div className="flex items-center gap-2">
                      {c.opportunityScore && (
                        <span className="text-xs text-muted-foreground tabular-nums">{c.opportunityScore.overallScore}</span>
                      )}
                      <ChevronRight className="w-3 h-3 text-muted-foreground group-hover:text-primary" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {topIncome.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Income</p>
            <div className="space-y-1">
              {topIncome.map(c => (
                <Link key={c.symbol} href={`/opportunities/${c.symbol}`}
                  onClick={() => onItemClick({ type: "stock", label: c.symbol, href: `/opportunities/${c.symbol}` })}>
                  <div className="flex items-center justify-between py-1 px-2 rounded hover:bg-muted/60 cursor-pointer group">
                    <span className="font-mono text-sm font-semibold group-hover:text-primary">{c.symbol}</span>
                    {c.opportunityScore && (
                      <span className="text-xs text-muted-foreground tabular-nums">{c.opportunityScore.overallScore}</span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {approaching.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Approaching</p>
            <div className="flex flex-wrap gap-1">
              {approaching.map(c => (
                <Link key={c.symbol} href={`/opportunities/${c.symbol}`}
                  onClick={() => onItemClick({ type: "stock", label: c.symbol, href: `/opportunities/${c.symbol}` })}>
                  <span className="text-xs px-2 py-0.5 bg-muted rounded font-mono cursor-pointer hover:bg-muted/80">{c.symbol}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="pt-1 border-t border-border/50">
          <Link href="/opportunities/today">
            <Button variant="ghost" size="sm" className="w-full text-xs h-7 text-primary">
              View All Opportunities <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Module: Market Intelligence
// ---------------------------------------------------------------------------

function MarketIntelligenceModule({ data, isPending, isError, onItemClick }: {
  data:        BriefingResponse | undefined;
  isPending:   boolean;
  isError:     boolean;
  onItemClick: (item: Omit<RecentItem, "viewedAt">) => void;
}) {
  if (isPending) return (
    <Card>
      <CardHeader className="pb-2"><Skeleton className="h-4 w-36" /></CardHeader>
      <CardContent className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-7 rounded" />)}</CardContent>
    </Card>
  );

  if (isError || !data) return (
    <Card className="border-dashed">
      <CardContent className="py-8 text-center">
        <Activity className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">Market intelligence is not available yet.</p>
        <p className="text-xs text-muted-foreground/60 mt-0.5">{isError ? "Will retry automatically" : "Computed after each scan cycle"}</p>
      </CardContent>
    </Card>
  );

  if (!data.hasData) return (
    <Card className="border-dashed">
      <CardContent className="py-8 text-center">
        <Activity className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">Intelligence data not yet available</p>
        <p className="text-xs text-muted-foreground/60 mt-0.5">Computed after each scan cycle</p>
      </CardContent>
    </Card>
  );

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-primary" />
            Market Intelligence
          </CardTitle>
          <div className="flex items-center gap-2">
            {data.regime && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{data.regime}</Badge>
            )}
            {data.generatedAt && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" />{formatFreshness(data.generatedAt)}
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">

        {data.marketHealth != null && (
          <div className="flex items-center justify-between py-1 px-2 bg-muted/30 rounded">
            <span className="text-xs text-muted-foreground">Market Health</span>
            <span className={cn("text-sm font-bold tabular-nums", healthColor(data.marketHealth))}>
              {data.marketHealth} <span className="text-muted-foreground font-normal text-[10px]">/ 100</span>
            </span>
          </div>
        )}

        {data.leadingThemes.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Leading Themes</p>
            <div className="space-y-0.5">
              {data.leadingThemes.slice(0, 4).map(t => (
                <Link key={t.themeId} href={`/intelligence/themes/${t.themeId}`}
                  onClick={() => onItemClick({ type: "theme", label: t.themeName, href: `/intelligence/themes/${t.themeId}` })}>
                  <div className="flex items-center justify-between py-0.5 px-2 rounded hover:bg-muted/60 cursor-pointer group">
                    <span className="text-xs group-hover:text-primary truncate">{t.themeName}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-xs font-semibold tabular-nums">{t.score}</span>
                      {directionIcon(t.direction)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {data.leadingSectors.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Leading Sectors</p>
            <div className="flex flex-wrap gap-1">
              {data.leadingSectors.map(s => (
                <Link key={s} href={`/intelligence/sectors/${encodeURIComponent(s)}`}
                  onClick={() => onItemClick({ type: "sector", label: s, href: `/intelligence/sectors/${encodeURIComponent(s)}` })}>
                  <span className="text-xs px-2 py-0.5 bg-muted rounded cursor-pointer hover:bg-muted/80">{s}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="pt-1 border-t border-border/50">
          <Link href="/intelligence">
            <Button variant="ghost" size="sm" className="w-full text-xs h-7 text-primary">
              Explore Market Intelligence <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Module: Changes
// ---------------------------------------------------------------------------

function ChangesModule({ data }: { data: ChangesResponse | undefined }) {
  if (!data) return (
    <Card>
      <CardHeader className="pb-2"><Skeleton className="h-4 w-24" /></CardHeader>
      <CardContent className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 rounded" />)}</CardContent>
    </Card>
  );

  if (!data.available) return (
    <Card className="border-dashed">
      <CardContent className="py-8 text-center">
        <BarChart2 className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">Change data not yet available</p>
        <p className="text-xs text-muted-foreground/60 mt-0.5">{data.message ?? "Waiting for first ranking cycle"}</p>
      </CardContent>
    </Card>
  );

  // Combine major movers + first 2 upgrades + first 2 downgrades + first new entry, dedupe
  const shown = new Set<string>();
  const items: ChangeExplanation[] = [];
  for (const c of [...data.majorMovers, ...data.upgrades, ...data.downgrades, ...data.newEntries]) {
    if (!shown.has(c.symbol) && items.length < 6) { shown.add(c.symbol); items.push(c); }
  }

  function ChangeRow({ c }: { c: ChangeExplanation }) {
    const isUp   = c.direction === "upgraded" || c.direction === "new";
    const isDown = c.direction === "downgraded" || c.direction === "removed";
    return (
      <Link href={`/opportunities/${c.symbol}`}>
        <div className="flex items-start justify-between gap-2 py-1 px-2 rounded hover:bg-muted/60 cursor-pointer group">
          <div className="flex items-center gap-2 min-w-0">
            {isUp   && <TrendingUp   className="w-3 h-3 text-emerald-500 shrink-0" />}
            {isDown && <TrendingDown className="w-3 h-3 text-red-500 shrink-0" />}
            {!isUp && !isDown && <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />}
            <div className="min-w-0">
              <span className="font-mono text-xs font-semibold group-hover:text-primary">{c.symbol}</span>
              <p className="text-[10px] text-muted-foreground truncate">{c.drivers[0] ?? c.summary}</p>
            </div>
          </div>
          {c.scoreDelta != null && (
            <span className={cn("text-[10px] font-medium tabular-nums shrink-0",
              c.scoreDelta > 0 ? "text-emerald-600" : c.scoreDelta < 0 ? "text-red-600" : "text-muted-foreground")}>
              {c.scoreDelta > 0 ? `+${c.scoreDelta}` : c.scoreDelta}
            </span>
          )}
        </div>
      </Link>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <BarChart2 className="w-3.5 h-3.5 text-primary" />
            Changes
          </CardTitle>
          {data.generatedAt && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5" />{formatFreshness(data.generatedAt)}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-1">
        {items.length === 0 && (
          <p className="text-xs text-muted-foreground py-3 text-center">No significant changes in this cycle</p>
        )}
        {items.map(c => <ChangeRow key={c.symbol} c={c} />)}

        <div className="pt-2 border-t border-border/50">
          <Link href="/opportunities/changes">
            <Button variant="ghost" size="sm" className="w-full text-xs h-7 text-primary">
              See What Changed <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Module: Institutional Activity
// ---------------------------------------------------------------------------

function InstitutionalActivityModule({ briefing, isPending, isError }: {
  briefing:  BriefingResponse | undefined;
  isPending: boolean;
  isError:   boolean;
}) {
  if (isPending) return (
    <Card>
      <CardHeader className="pb-2"><Skeleton className="h-4 w-40" /></CardHeader>
      <CardContent className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 rounded" />)}</CardContent>
    </Card>
  );

  if (isError || !briefing) return (
    <Card className="border-dashed">
      <CardContent className="py-8 text-center">
        <Building2 className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">Institutional activity is not available yet.</p>
        <p className="text-xs text-muted-foreground/60 mt-0.5">{isError ? "Will retry automatically" : "Computed after each scan cycle"}</p>
      </CardContent>
    </Card>
  );

  const h = briefing.institutionalHighlights;
  const hasHighlights = h.accumulationSignals > 0 || h.newRankedOpportunities > 0 ||
                        h.themesStrengthened > 0 || h.sectorsWeakened > 0;

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between flex-wrap gap-1">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-primary" />
            Institutional Activity
          </CardTitle>
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-amber-400/50 text-amber-600 dark:text-amber-400">
            SEC Form 13F · Delayed Data
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">

        {!briefing.hasData && (
          <p className="text-xs text-muted-foreground py-2 text-center">
            Institutional data requires at least one 13F ingestion run
          </p>
        )}

        {briefing.hasData && !hasHighlights && (
          <p className="text-xs text-muted-foreground py-2 text-center">
            No institutional activity signals in the current period
          </p>
        )}

        {briefing.hasData && hasHighlights && (
          <div className="space-y-2">
            {h.accumulationSignals > 0 && (
              <div className="flex items-center justify-between py-1.5 px-2 bg-emerald-50 dark:bg-emerald-900/20 rounded">
                <span className="text-xs text-muted-foreground">Accumulation Evidence</span>
                <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                  {h.accumulationSignals} signal{h.accumulationSignals !== 1 ? "s" : ""}
                </span>
              </div>
            )}
            {h.themesStrengthened > 0 && (
              <div className="flex items-center justify-between py-1.5 px-2 bg-blue-50 dark:bg-blue-900/20 rounded">
                <span className="text-xs text-muted-foreground">Themes Strengthened</span>
                <span className="text-xs font-semibold text-blue-700 dark:text-blue-400 tabular-nums">
                  {h.themesStrengthened}
                </span>
              </div>
            )}
            {h.sectorsWeakened > 0 && (
              <div className="flex items-center justify-between py-1.5 px-2 bg-orange-50 dark:bg-orange-900/20 rounded">
                <span className="text-xs text-muted-foreground">Sectors Weakened</span>
                <span className="text-xs font-semibold text-orange-700 dark:text-orange-400 tabular-nums">
                  {h.sectorsWeakened}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="text-[10px] text-muted-foreground/70 bg-muted/40 rounded px-2 py-1.5">
          Reported institutional holdings reflect SEC Form 13F filings.
          Data is delayed by 45+ days and does not reflect current positions.
        </div>

        <div className="pt-1 border-t border-border/50">
          <Link href="/institutional/funds">
            <Button variant="ghost" size="sm" className="w-full text-xs h-7 text-primary">
              Explore Institutional Research <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Module: Funds
// ---------------------------------------------------------------------------

function FundsModule({ data, onItemClick }: {
  data:        FundsResponse | undefined;
  onItemClick: (item: Omit<RecentItem, "viewedAt">) => void;
}) {
  if (!data) return (
    <Card>
      <CardHeader className="pb-2"><Skeleton className="h-4 w-28" /></CardHeader>
      <CardContent className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 rounded" />)}</CardContent>
    </Card>
  );

  const funds = data.funds.slice(0, 5);

  if (funds.length === 0) return (
    <Card className="border-dashed">
      <CardContent className="py-8 text-center">
        <Landmark className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">No fund data available yet</p>
        <p className="text-xs text-muted-foreground/60 mt-0.5">Requires at least one 13F ingestion run</p>
      </CardContent>
    </Card>
  );

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Landmark className="w-3.5 h-3.5 text-primary" />
            Funds
          </CardTitle>
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-amber-400/50 text-amber-600 dark:text-amber-400">
            SEC Form 13F · Delayed
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-1">
        {funds.map(f => (
          <Link key={f.managerId} href={`/institutional/funds/${f.managerId}`}
            onClick={() => onItemClick({ type: "fund", label: f.managerName, href: `/institutional/funds/${f.managerId}` })}>
            <div className="flex items-start justify-between gap-2 py-1.5 px-2 rounded hover:bg-muted/60 cursor-pointer group">
              <div className="min-w-0">
                <p className="text-xs font-medium group-hover:text-primary truncate">{f.managerName}</p>
                <p className="text-[10px] text-muted-foreground">
                  {f.reportedPositionCount != null ? `${f.reportedPositionCount} positions` : ""}
                  {f.latestQuarter ? ` · Q${f.latestQuarter}` : ""}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-semibold tabular-nums">{formatPortfolioValue(f.reportedPortfolioValue)}</p>
                <ChevronRight className="w-3 h-3 text-muted-foreground group-hover:text-primary ml-auto mt-0.5" />
              </div>
            </div>
          </Link>
        ))}

        <div className="pt-2 border-t border-border/50">
          <Link href="/institutional/funds">
            <Button variant="ghost" size="sm" className="w-full text-xs h-7 text-primary">
              Explore Funds <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Module: Events (graceful unavailable)
// ---------------------------------------------------------------------------

function EventsModule() {
  return (
    <Card className="border-dashed border-muted/60">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm flex items-center gap-1.5 text-muted-foreground">
          <Calendar className="w-3.5 h-3.5" />
          Events
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-5 text-center">
        <Calendar className="w-6 h-6 text-muted-foreground/20 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">Event calendar not yet configured</p>
        <p className="text-[10px] text-muted-foreground/60 mt-1 max-w-[200px] mx-auto">
          Earnings, economic events, and macro data will appear here once an event provider is connected.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Search bar + results
// ---------------------------------------------------------------------------

function ResearchSearch({ index, onResultClick }: {
  index:         SearchResult[];
  onResultClick: (r: SearchResult) => void;
}) {
  const [query, setQuery]   = useState("");
  const [open,  setOpen]    = useState(false);
  const inputRef            = useRef<HTMLInputElement>(null);
  const [, navigate]        = useLocation();

  const results  = useMemo(() => runSearch(index, query), [index, query]);
  const grouped  = useMemo(() => groupSearchResults(results), [results]);
  const hasResults = results.length > 0;

  function handleSelect(r: SearchResult) {
    setQuery("");
    setOpen(false);
    onResultClick(r);
    navigate(r.href);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setQuery(""); setOpen(false); }
    if (e.key === "Enter" && results.length > 0) handleSelect(results[0]);
  }

  useEffect(() => {
    setOpen(query.length > 0 && hasResults);
  }, [query, hasResults]);

  const TYPE_COLORS: Record<string, string> = {
    Stocks:  "text-emerald-600 dark:text-emerald-400",
    Themes:  "text-blue-600 dark:text-blue-400",
    Sectors: "text-yellow-600 dark:text-yellow-600",
    Funds:   "text-purple-600 dark:text-purple-400",
  };

  return (
    <div className="relative w-full max-w-xl">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Search symbols, themes, sectors, funds…"
          className="pl-9 pr-9 text-sm"
          data-testid="research-search-input"
        />
        {query && (
          <button
            onClick={() => { setQuery(""); setOpen(false); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div
          className="absolute z-50 top-full mt-1 w-full bg-popover border border-border rounded-lg shadow-lg overflow-hidden"
          data-testid="research-search-results"
        >
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group}>
              <div className="px-3 py-1.5 bg-muted/40 border-b border-border">
                <span className={cn("text-[10px] font-semibold uppercase tracking-wide", TYPE_COLORS[group] ?? "text-muted-foreground")}>
                  {group}
                </span>
              </div>
              {items.slice(0, 5).map(r => (
                <button
                  key={r.href}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 flex items-center justify-between gap-2"
                  onClick={() => handleSelect(r)}
                  data-testid={`search-result-${r.type}`}
                >
                  <span className="font-medium">{r.label}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{r.sublabel}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recently Viewed chips
// ---------------------------------------------------------------------------

function RecentlyViewedBar({ items, onItemClick }: {
  items:       RecentItem[];
  onItemClick: (item: Omit<RecentItem, "viewedAt">) => void;
}) {
  if (items.length === 0) return null;

  const TYPE_ICON: Record<string, React.ReactNode> = {
    stock:  <TrendingUp  className="w-2.5 h-2.5" />,
    theme:  <Layers      className="w-2.5 h-2.5" />,
    sector: <BarChart2   className="w-2.5 h-2.5" />,
    fund:   <Landmark    className="w-2.5 h-2.5" />,
  };

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="recently-viewed">
      <span className="text-xs text-muted-foreground flex items-center gap-1">
        <Clock className="w-3 h-3" /> Recent:
      </span>
      {items.map(item => (
        <Link key={item.href} href={item.href}
          onClick={() => onItemClick({ type: item.type, label: item.label, href: item.href })}>
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-muted rounded-full hover:bg-muted/80 cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
            {TYPE_ICON[item.type]}
            {item.label}
          </span>
        </Link>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function MarketResearchHub() {
  const { items: recentItems, addItem } = useRecentlyViewed();

  const todayQuery = useQuery<TodayRankingResponse>({
    queryKey:       ["/api/opportunities/today"],
    staleTime:      5  * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });

  const briefingQuery = useQuery<BriefingResponse>({
    queryKey:       ["/api/intelligence/briefing"],
    staleTime:      5  * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });

  const changesQuery = useQuery<ChangesResponse>({
    queryKey:       ["/api/opportunities/changes/explained"],
    staleTime:      5  * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });

  const fundsQuery = useQuery<FundsResponse>({
    queryKey: ["/api/institutional/funds", { sort: "reportedPortfolioValue", pageSize: 8 }],
    queryFn:  async () => {
      const r = await fetch("/api/institutional/funds?sort=reportedPortfolioValue&pageSize=8");
      if (!r.ok) throw new Error("Failed to load funds");
      return r.json();
    },
    staleTime: 60 * 60 * 1000,
  });

  // Build search index from loaded data
  const searchIndex = useMemo<SearchResult[]>(() => {
    const stocks  = [
      ...(todayQuery.data?.ranking?.topGrowth.map(c => c.symbol)  ?? []),
      ...(todayQuery.data?.ranking?.topIncome.map(c => c.symbol)   ?? []),
      ...(todayQuery.data?.ranking?.watchlist.map(c => c.symbol)   ?? []),
      ...(todayQuery.data?.ranking?.approaching.map(c => c.symbol) ?? []),
    ];
    const themes  = briefingQuery.data?.leadingThemes ?? [];
    const sectors = briefingQuery.data?.leadingSectors ?? [];
    const funds   = fundsQuery.data?.funds ?? [];
    return buildSearchIndex(
      Array.from(new Set(stocks)),
      themes,
      sectors,
      funds,
    );
  }, [todayQuery.data, briefingQuery.data, fundsQuery.data]);

  function handleSearchResultClick(r: SearchResult) {
    addItem({ type: r.type, label: r.label, href: r.href });
  }

  function handleItemClick(item: Omit<RecentItem, "viewedAt">) {
    addItem(item);
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">

      {/* Header */}
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Market Research</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Explore opportunities, market leadership, institutional activity, and important changes across the market.
          </p>
        </div>

        {/* Search */}
        <ResearchSearch index={searchIndex} onResultClick={handleSearchResultClick} />

        {/* Recently Viewed */}
        <RecentlyViewedBar items={recentItems} onItemClick={handleItemClick} />
      </div>

      {/* Sub-navigation */}
      <nav className="flex items-center gap-1 flex-wrap" data-testid="research-subnav" aria-label="Research sections">
        {SUB_NAV.map(item => (
          <Link key={item.label} href={item.href}>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground">
              <item.icon className="w-3 h-3" />
              {item.label}
            </Button>
          </Link>
        ))}
      </nav>

      {/* Disclaimer */}
      <Alert className="border-muted py-2">
        <Info className="h-3.5 w-3.5" />
        <AlertDescription className="text-xs text-muted-foreground">
          This hub organizes research evidence — not recommendations. Nothing here constitutes investment advice.
        </AlertDescription>
      </Alert>

      {/* Module grid — 2 columns on md+, 1 on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Row 1: Opportunities + Market Intelligence */}
        <OpportunitiesModule
          data={todayQuery.data}
          onItemClick={handleItemClick}
        />
        <MarketIntelligenceModule
          data={briefingQuery.data}
          isPending={briefingQuery.isPending}
          isError={briefingQuery.isError}
          onItemClick={handleItemClick}
        />

        {/* Row 2: Changes + Institutional Activity */}
        <ChangesModule data={changesQuery.data} />
        <InstitutionalActivityModule
          briefing={briefingQuery.data}
          isPending={briefingQuery.isPending}
          isError={briefingQuery.isError}
        />

        {/* Row 3: Funds + Events */}
        <FundsModule data={fundsQuery.data} onItemClick={handleItemClick} />
        <EventsModule />

      </div>

    </div>
  );
}
