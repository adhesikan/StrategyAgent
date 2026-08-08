// Intelligence Overview Page — Sprint 2.3.3
// Route: /intelligence
//
// Shows precomputed sector and theme research intelligence.
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

// ---------------------------------------------------------------------------
// Types (must match server API shape)
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
  changes:     { scoreDelta?: number | null; newLeaders?: string[]; summary?: string };
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
  dashboardContracts: {
    leadingSectors:  unknown[];
    leadingThemes:   unknown[];
    improvingThemes: unknown[];
    weakeningThemes: unknown[];
  };
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

function labelBadgeVariant(label: string): "default" | "secondary" | "outline" {
  switch (label) {
    case "Strong":    return "default";
    case "Improving": return "default";
    case "Mixed":     return "secondary";
    default:          return "outline";
  }
}

function scoreDeltaIcon(delta: number | null | undefined) {
  if (delta == null)   return <Minus className="w-3 h-3 text-muted-foreground" />;
  if (delta >= 3)      return <TrendingUp className="w-3 h-3 text-emerald-500" />;
  if (delta <= -3)     return <TrendingDown className="w-3 h-3 text-red-500" />;
  return <Minus className="w-3 h-3 text-muted-foreground" />;
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

// ---------------------------------------------------------------------------
// Sector card
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
// Theme card
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
// Section headers
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

  const loading = sectorsQuery.isLoading || themesQuery.isLoading;

  const sectors = sectorsQuery.data?.sectors ?? [];
  const themes  = themesQuery.data?.themes ?? [];
  const hasData = sectorsQuery.data?.hasData || themesQuery.data?.hasData;

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

  // Regime from themes response
  const latestGenAt = themes[0]?.generatedAt
    ? new Date(themes[0].generatedAt).toLocaleString()
    : null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          Sector & Theme Intelligence
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

      {/* Loading skeletons */}
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
          <SectionHeader icon={BarChart2} title="Leading Sectors" count={sectors.length} />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {leadingSectors.map(s => (
              <SectorCard key={s.sector} s={s} />
            ))}
          </div>
          {sectors.length > 5 && (
            <div className="mt-3 flex justify-end">
              <Link href="/intelligence/sectors">
                <span className="text-xs text-primary hover:underline">View all {sectors.length} sectors →</span>
              </Link>
            </div>
          )}
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

      {/* All Themes (compact) */}
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
