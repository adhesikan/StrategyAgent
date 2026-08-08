// Intelligence Overview Page
// Route: /intelligence
//
// "Today's Market Intelligence" command-center briefing, followed by detailed
// sector and theme grids.
// COMPLIANCE: No buy/sell/bullish/bearish language. Scores = research evidence breadth.

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart2,
  Layers,
  AlertCircle,
  ChevronRight,
  Info,
  Activity,
  Globe2,
  Zap,
  Building2,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SectorSummary {
  sector:      string;
  score:       number | null;
  label:       string;
  generatedAt: string | null;
  metrics:     Record<string, unknown>;
  topSymbols:  Array<{ symbol: string; overallScore: number }>;
  changes:     { scoreDelta?: number | null; newLeaders?: string[]; summary?: string };
}

interface ThemeSummary {
  themeId:     string;
  themeName:   string;
  score:       number | null;
  label:       string;
  generatedAt: string | null;
  metrics:     Record<string, unknown>;
  topSymbols:  Array<{ symbol: string; overallScore: number }>;
  changes:     { scoreDelta?: number | null; newLeaders?: string[]; summary?: string; strengtheningSymbols?: string[] };
}

interface BriefingResponse {
  regime:          string | null;
  marketHealth:    number | null;
  hasData:         boolean;
  generatedAt:     string | null;
  leadingThemes:   Array<{ themeId: string; themeName: string; score: number; direction: "up" | "down" | "stable" }>;
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

interface SectorsResponse {
  sectors: SectorSummary[];
  count:   number;
  hasData: boolean;
  disclaimer: string;
}

interface ThemesResponse {
  themes:   ThemeSummary[];
  count:    number;
  hasData:  boolean;
  disclaimer: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function labelColor(label: string): string {
  switch (label) {
    case "Strong":    return "text-emerald-600 dark:text-emerald-400";
    case "Improving": return "text-blue-600   dark:text-blue-400";
    case "Mixed":     return "text-yellow-600 dark:text-yellow-400";
    case "Weakening": return "text-orange-600 dark:text-orange-400";
    case "Weak":      return "text-red-600    dark:text-red-400";
    default:          return "text-muted-foreground";
  }
}

function scoreDeltaIcon(delta: number | null | undefined) {
  if (delta == null)   return <Minus className="w-3 h-3 text-muted-foreground" />;
  if (delta >= 3)      return <TrendingUp className="w-3 h-3 text-emerald-500" />;
  if (delta <= -3)     return <TrendingDown className="w-3 h-3 text-red-500" />;
  return <Minus className="w-3 h-3 text-muted-foreground" />;
}

function DirectionIcon({ direction }: { direction: "up" | "down" | "stable" }) {
  if (direction === "up")   return <ArrowUp   className="w-4 h-4 text-emerald-500" />;
  if (direction === "down") return <ArrowDown className="w-4 h-4 text-red-500" />;
  return <ArrowRight className="w-4 h-4 text-muted-foreground" />;
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="w-full bg-muted rounded-full h-1.5 mt-1">
      <div
        className={cn(
          "h-1.5 rounded-full transition-all",
          pct >= 75 ? "bg-emerald-500" :
          pct >= 60 ? "bg-blue-500" :
          pct >= 40 ? "bg-yellow-500" :
          pct >= 25 ? "bg-orange-500" : "bg-red-500",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function healthColor(score: number) {
  if (score >= 75) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 60) return "text-blue-600 dark:text-blue-400";
  if (score >= 40) return "text-yellow-600 dark:text-yellow-400";
  return "text-orange-600 dark:text-orange-400";
}

// ---------------------------------------------------------------------------
// Today's Briefing — command-center hero card
// ---------------------------------------------------------------------------

function BriefingCard({ data }: { data: BriefingResponse }) {
  const { regime, marketHealth, leadingThemes, leadingSectors, mostImprovedThemes,
          mostImprovedStocks, institutionalHighlights } = data;

  const highlights = institutionalHighlights;

  return (
    <Card className="border-2 border-primary/10 bg-card shadow-sm">
      <CardHeader className="pb-3 pt-4 px-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Globe2 className="w-4 h-4 text-primary" />
            Today&apos;s Market Intelligence
          </CardTitle>
          {regime && (
            <Badge variant="secondary" className="text-xs font-medium px-2.5 py-0.5">
              {regime}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="px-5 pb-5 space-y-5">

        {/* Top row — two columns on md+ */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

          {/* Leading Themes */}
          {leadingThemes.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Leading Themes
              </p>
              <div className="space-y-1.5">
                {leadingThemes.map(t => (
                  <Link key={t.themeId} href={`/intelligence/themes/${t.themeId}`}>
                    <div className="flex items-center justify-between gap-2 py-1 px-2 rounded-md hover:bg-muted/60 transition-colors cursor-pointer group">
                      <span className="text-sm font-medium group-hover:text-primary transition-colors truncate">
                        {t.themeName}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-sm font-bold tabular-nums">{t.score}</span>
                        <DirectionIcon direction={t.direction} />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Market Health + Institutional Highlights */}
          <div className="space-y-4">
            {marketHealth != null && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                  Market Health
                </p>
                <div className="flex items-baseline gap-1">
                  <span className={cn("text-3xl font-bold tabular-nums", healthColor(marketHealth))}>
                    {marketHealth}
                  </span>
                  <span className="text-sm text-muted-foreground font-medium">/ 100</span>
                </div>
                <ScoreBar score={marketHealth} />
              </div>
            )}

            {(highlights.accumulationSignals > 0 ||
              highlights.newRankedOpportunities > 0 ||
              highlights.themesStrengthened > 0 ||
              highlights.sectorsWeakened > 0) && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Institutional Highlights
                </p>
                <ul className="space-y-1 text-sm">
                  {highlights.accumulationSignals > 0 && (
                    <li className="flex items-center gap-2 text-muted-foreground">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <span><span className="font-semibold text-foreground">{highlights.accumulationSignals}</span> new institutional accumulation signals</span>
                    </li>
                  )}
                  {highlights.newRankedOpportunities > 0 && (
                    <li className="flex items-center gap-2 text-muted-foreground">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                      <span><span className="font-semibold text-foreground">{highlights.newRankedOpportunities}</span> new ranked opportunities</span>
                    </li>
                  )}
                  {highlights.themesStrengthened > 0 && (
                    <li className="flex items-center gap-2 text-muted-foreground">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary/70 shrink-0" />
                      <span><span className="font-semibold text-foreground">{highlights.themesStrengthened}</span> {highlights.themesStrengthened === 1 ? "theme" : "themes"} strengthened</span>
                    </li>
                  )}
                  {highlights.sectorsWeakened > 0 && (
                    <li className="flex items-center gap-2 text-muted-foreground">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                      <span><span className="font-semibold text-foreground">{highlights.sectorsWeakened}</span> {highlights.sectorsWeakened === 1 ? "sector" : "sectors"} weakened</span>
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Bottom row — secondary intel */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1 border-t border-border/50">

          {/* Leading Sectors */}
          {leadingSectors.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                Leading Sectors
              </p>
              <div className="flex flex-col gap-1">
                {leadingSectors.map(s => (
                  <Link key={s} href={`/intelligence/sectors/${encodeURIComponent(s)}`}>
                    <span className="text-sm font-medium hover:text-primary transition-colors cursor-pointer">{s}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Most Improved Themes */}
          {mostImprovedThemes.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                Most Improved Themes
              </p>
              <div className="flex flex-col gap-1">
                {mostImprovedThemes.map(t => (
                  <Link key={t.themeId} href={`/intelligence/themes/${t.themeId}`}>
                    <span className="text-sm font-medium hover:text-primary transition-colors cursor-pointer">{t.themeName}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Most Improved Stocks */}
          {mostImprovedStocks.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                Most Improved Stocks
              </p>
              <div className="flex flex-wrap gap-1.5">
                {mostImprovedStocks.map(sym => (
                  <Link key={sym} href={`/opportunities/${sym}`}>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-mono font-semibold hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors cursor-pointer">
                      {sym}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sector card (detailed grid)
// ---------------------------------------------------------------------------

function SectorCard({ s }: { s: SectorSummary }) {
  const delta = s.changes?.scoreDelta;
  const rankedCount = (s.metrics?.rankedSymbolCount as number) ?? 0;
  const eligibleCount = (s.metrics?.eligibleSymbolCount as number) ?? 0;

  return (
    <Link href={`/intelligence/sectors/${encodeURIComponent(s.sector)}`}>
      <Card className="group cursor-pointer hover:border-primary/40 transition-colors">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate">{s.sector}</span>
                <span className={cn("text-xs font-semibold", labelColor(s.label))}>{s.label}</span>
              </div>
              {s.score != null && <ScoreBar score={s.score} />}
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                <span>{rankedCount} ranked</span>
                {eligibleCount > 0 && <span className="text-muted-foreground/60">/ {eligibleCount} eligible</span>}
                <span className="flex items-center gap-0.5">
                  {scoreDeltaIcon(delta)}
                  {delta != null && <span>{delta > 0 ? `+${delta}` : delta}</span>}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {s.score != null && (
                <span className={cn("text-lg font-bold tabular-nums", labelColor(s.label))}>
                  {s.score}
                </span>
              )}
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </div>
          {s.topSymbols?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {s.topSymbols.slice(0, 4).map((sym) => (
                <span key={sym.symbol} className="text-xs px-1.5 py-0.5 bg-muted rounded font-mono">
                  {sym.symbol}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Theme card (detailed grid)
// ---------------------------------------------------------------------------

function ThemeCard({ t }: { t: ThemeSummary }) {
  const delta      = t.changes?.scoreDelta;
  const metrics    = t.metrics ?? {};
  const breadth    = (metrics.breadth as Record<string, number>) ?? {};
  const memberCount = (metrics.memberCount as number) ?? 0;
  const rankedCount = (metrics.rankedMemberCount as number) ?? 0;

  return (
    <Link href={`/intelligence/themes/${t.themeId}`}>
      <Card className="group cursor-pointer hover:border-primary/40 transition-colors">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{t.themeName}</span>
                <span className={cn("text-xs font-semibold", labelColor(t.label))}>{t.label}</span>
              </div>
              {t.score != null && <ScoreBar score={t.score} />}
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                <span>{rankedCount}/{memberCount} ranked</span>
                {breadth.opportunityBreadth != null && (
                  <span>{breadth.opportunityBreadth}% opportunity</span>
                )}
                <span className="flex items-center gap-0.5">
                  {scoreDeltaIcon(delta)}
                  {delta != null && <span>{delta > 0 ? `+${delta}` : delta}</span>}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {t.score != null && (
                <span className={cn("text-lg font-bold tabular-nums", labelColor(t.label))}>
                  {t.score}
                </span>
              )}
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </div>
          {t.topSymbols?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {t.topSymbols.slice(0, 4).map((sym) => (
                <span key={sym.symbol} className="text-xs px-1.5 py-0.5 bg-muted rounded font-mono">
                  {sym.symbol}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({ icon: Icon, title, count }: { icon: React.ElementType; title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4 text-muted-foreground" />
      <h2 className="font-semibold text-sm">{title}</h2>
      {count != null && (
        <span className="text-xs text-muted-foreground ml-auto">{count} total</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function IntelligencePage() {
  const briefingQuery = useQuery<BriefingResponse>({
    queryKey: ["/api/intelligence/briefing"],
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });

  const sectorsQuery = useQuery<SectorsResponse>({
    queryKey: ["/api/intelligence/sectors"],
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });

  const themesQuery = useQuery<ThemesResponse>({
    queryKey: ["/api/intelligence/themes"],
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });

  const loading   = sectorsQuery.isLoading || themesQuery.isLoading;
  const briefing  = briefingQuery.data;

  const sectors = sectorsQuery.data?.sectors ?? [];
  const themes  = themesQuery.data?.themes ?? [];
  const hasData = briefing?.hasData || sectorsQuery.data?.hasData || themesQuery.data?.hasData;

  // Derive improving/weakening/new-leader sections from live data
  const improving = themes.filter(t => {
    const delta = t.changes?.scoreDelta;
    return delta != null && delta >= 5;
  });

  const weakening = themes.filter(t => {
    const delta = t.changes?.scoreDelta;
    return delta != null && delta <= -5;
  });

  const newLeaderThemes = themes.filter(t =>
    Array.isArray(t.changes?.newLeaders) && (t.changes.newLeaders as string[]).length > 0,
  );

  const leadingSectors = [...sectors].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 5);
  const leadingThemes  = [...themes].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 5);

  const latestGenAt = themes[0]?.generatedAt
    ? new Date(themes[0].generatedAt).toLocaleString()
    : null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">

      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          Sector &amp; Theme Intelligence
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Research evidence breadth across sectors and themes. Updated after each scan cycle.
        </p>
        {latestGenAt && (
          <p className="text-xs text-muted-foreground/60 mt-0.5">Last computed: {latestGenAt}</p>
        )}
      </div>

      {/* Disclaimer */}
      <Alert className="border-muted">
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs text-muted-foreground">
          Scores reflect the strength of current research evidence — not sector or theme performance predictions.
          Nothing on this page constitutes investment advice.
        </AlertDescription>
      </Alert>

      {/* No data state */}
      {!loading && !hasData && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <BarChart2 className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No intelligence snapshots yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1 max-w-sm mx-auto">
              Sector and theme intelligence is computed after each Opportunity Ranking cycle.
              The first snapshot will appear after the next scan completes.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Loading — briefing skeleton */}
      {briefingQuery.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      )}

      {/* Today's Briefing card */}
      {briefing?.hasData && <BriefingCard data={briefing} />}

      {/* Loading — grid skeletons */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      )}

      {/* Leading Sectors */}
      {!loading && leadingSectors.length > 0 && (
        <section>
          <SectionHeader icon={BarChart2} title="Sectors" count={sectors.length} />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {leadingSectors.map(s => (
              <SectorCard key={s.sector} s={s} />
            ))}
          </div>
        </section>
      )}

      {/* Leading Themes */}
      {!loading && leadingThemes.length > 0 && (
        <section>
          <SectionHeader icon={Layers} title="Leading Themes" count={themes.length} />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {leadingThemes.map(t => (
              <ThemeCard key={t.themeId} t={t} />
            ))}
          </div>
        </section>
      )}

      {/* All Themes (compact — beyond top 5) */}
      {!loading && themes.length > 5 && (
        <section>
          <SectionHeader icon={Layers} title="All Themes" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {themes.slice(5).map(t => (
              <ThemeCard key={t.themeId} t={t} />
            ))}
          </div>
        </section>
      )}

      {/* Improving */}
      {!loading && improving.length > 0 && (
        <section>
          <SectionHeader icon={TrendingUp} title="Improving" count={improving.length} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {improving.map(t => (
              <Link key={t.themeId} href={`/intelligence/themes/${t.themeId}`}>
                <Card className="group cursor-pointer hover:border-emerald-400/40 transition-colors">
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">{t.themeName}</span>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {t.changes?.summary ?? `Score: ${t.score}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <TrendingUp className="w-4 h-4 text-emerald-500" />
                      {t.changes?.scoreDelta != null && (
                        <span className="text-xs font-medium text-emerald-600">+{t.changes.scoreDelta}</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Weakening */}
      {!loading && weakening.length > 0 && (
        <section>
          <SectionHeader icon={TrendingDown} title="Weakening" count={weakening.length} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {weakening.map(t => (
              <Link key={t.themeId} href={`/intelligence/themes/${t.themeId}`}>
                <Card className="group cursor-pointer hover:border-red-400/40 transition-colors">
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">{t.themeName}</span>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {t.changes?.summary ?? `Score: ${t.score}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <TrendingDown className="w-4 h-4 text-red-500" />
                      {t.changes?.scoreDelta != null && (
                        <span className="text-xs font-medium text-red-600">{t.changes.scoreDelta}</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* New Leadership */}
      {!loading && newLeaderThemes.length > 0 && (
        <section>
          <SectionHeader icon={Activity} title="New Leadership" count={newLeaderThemes.length} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {newLeaderThemes.slice(0, 4).map(t => (
              <Link key={t.themeId} href={`/intelligence/themes/${t.themeId}`}>
                <Card className="group cursor-pointer hover:border-primary/40 transition-colors">
                  <CardContent className="p-3">
                    <span className="text-sm font-medium">{t.themeName}</span>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {(t.changes?.newLeaders as string[] ?? []).map(sym => (
                        <span key={sym} className="text-xs px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded font-mono">
                          {sym}
                        </span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

    </div>
  );
}
