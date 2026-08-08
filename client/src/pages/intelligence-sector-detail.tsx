// Sector Detail Page — Sprint 2.3.3
// Route: /intelligence/sectors/:sector
//
// Shows sector-level research intelligence metrics and top symbols.
// COMPLIANCE: No buy/sell/bullish/bearish language.

import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  BarChart2,
  Info,
  AlertCircle,
  ChevronRight,
  Activity,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TopSymbol {
  symbol:             string;
  overallScore:       number;
  technicalScore:     number;
  institutionalScore: number;
  confidence:         string;
  category:           string;
}

interface SectorDetailResponse {
  sector:      string;
  score:       number | null;
  label:       string;
  generatedAt: string | null;
  metrics: {
    eligibleSymbolCount:             number;
    rankedSymbolCount:               number;
    averageOpportunityScore:         number;
    medianOpportunityScore:          number;
    topOpportunityScore:             number;
    highConfidenceCount:             number;
    newOpportunityCount:             number;
    upgradedCount:                   number;
    downgradedCount:                 number;
    institutionalDataAvailableCount: number;
    institutionalAccumulationCount:  number;
    institutionalDistributionCount:  number;
    averageInstitutionalScore:       number;
    strengtheningCount:              number;
    weakeningCount:                  number;
    industries:                      string[];
    technicalCoverage:               number;
    institutionalCoverage:           number;
  };
  topSymbols: TopSymbol[];
  changes: {
    scoreDelta:           number | null;
    newLeaders:           string[];
    lostLeaders:          string[];
    strengtheningSymbols: string[];
    weakeningSymbols:     string[];
    summary:              string;
  };
  disclaimer: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function labelColor(label: string): string {
  switch (label) {
    case "Strong":    return "text-emerald-600 dark:text-emerald-400";
    case "Improving": return "text-blue-600 dark:text-blue-400";
    case "Mixed":     return "text-yellow-600 dark:text-yellow-400";
    case "Weakening": return "text-orange-600 dark:text-orange-400";
    case "Weak":      return "text-red-600 dark:text-red-400";
    default:          return "text-muted-foreground";
  }
}

function ScoreBar({ score, height = "h-2" }: { score: number; height?: string }) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className={cn("w-full bg-muted rounded-full", height)}>
      <div
        className={cn("rounded-full transition-all", height,
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

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-muted/40 rounded-lg p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold mt-0.5 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground/70 mt-0.5">{sub}</p>}
    </div>
  );
}

function SymbolRow({ sym }: { sym: TopSymbol }) {
  return (
    <Link href={`/opportunities/${sym.symbol}`}>
      <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/40 hover:bg-muted/70 cursor-pointer transition-colors">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium">{sym.symbol}</span>
          <span className="text-xs text-muted-foreground hidden sm:inline">{sym.category}</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="tabular-nums font-medium text-foreground">{sym.overallScore}</span>
          <span className={cn("capitalize",
            sym.confidence === "high" ? "text-emerald-600 dark:text-emerald-400" :
            sym.confidence === "medium" ? "text-blue-600 dark:text-blue-400" : "",
          )}>{sym.confidence}</span>
          <ChevronRight className="w-3 h-3" />
        </div>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function IntelligenceSectorDetailPage() {
  const { sector } = useParams<{ sector: string }>();
  const decodedSector = decodeURIComponent(sector ?? "");

  const query = useQuery<SectorDetailResponse>({
    queryKey: [`/api/intelligence/sectors/${encodeURIComponent(decodedSector)}`],
    enabled: !!sector,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });

  const data    = query.data;
  const metrics = data?.metrics;
  const changes = data?.changes;

  if (query.isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-3 gap-3">{[0,1,2].map(i => <Skeleton key={i} className="h-16" />)}</div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (query.isError || !data) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <Link href="/intelligence">
          <Button variant="ghost" size="sm" className="mb-4">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
        </Link>
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No intelligence snapshot available for this sector yet. Data is computed after each scan cycle.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

      <Link href="/intelligence">
        <Button variant="ghost" size="sm">
          <ArrowLeft className="w-4 h-4 mr-1" /> Sector & Theme Intelligence
        </Button>
      </Link>

      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold">{data.sector}</h1>
            {metrics?.industries && metrics.industries.length > 0 && (
              <p className="text-sm text-muted-foreground mt-1">
                Industries: {metrics.industries.slice(0, 5).join(", ")}
                {metrics.industries.length > 5 ? ` +${metrics.industries.length - 5} more` : ""}
              </p>
            )}
          </div>
          <div className="text-right">
            {data.score != null && (
              <p className={cn("text-4xl font-black tabular-nums", labelColor(data.label))}>
                {data.score}
              </p>
            )}
            <p className={cn("text-sm font-semibold", labelColor(data.label))}>{data.label}</p>
            {changes?.scoreDelta != null && (
              <p className={cn("text-xs mt-0.5", changes.scoreDelta >= 0 ? "text-emerald-600" : "text-red-600")}>
                {changes.scoreDelta >= 0 ? "+" : ""}{changes.scoreDelta} vs last scan
              </p>
            )}
          </div>
        </div>

        {data.score != null && (
          <div className="mt-3">
            <ScoreBar score={data.score} height="h-2.5" />
          </div>
        )}

        <div className="flex flex-wrap gap-4 mt-3 text-sm text-muted-foreground">
          <span>{metrics?.rankedSymbolCount ?? 0} ranked</span>
          <span>{metrics?.eligibleSymbolCount ?? 0} eligible</span>
          {data.generatedAt && (
            <span className="text-muted-foreground/60 text-xs">
              {new Date(data.generatedAt).toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* Disclaimer */}
      <Alert className="border-muted">
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs text-muted-foreground">{data.disclaimer}</AlertDescription>
      </Alert>

      {/* Change summary */}
      {changes?.summary && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm">{changes.summary}</p>
            <div className="flex flex-wrap gap-4 mt-2">
              {changes.newLeaders?.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">New leaders:</span>
                  {changes.newLeaders.map(s => (
                    <span key={s} className="text-xs px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded font-mono">{s}</span>
                  ))}
                </div>
              )}
              {changes.lostLeaders?.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Left top:</span>
                  {changes.lostLeaders.map(s => (
                    <span key={s} className="text-xs px-1.5 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded font-mono">{s}</span>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Metrics grid */}
      {metrics && (
        <section>
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-muted-foreground" /> Research Evidence Metrics
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <MetricCard label="Average Score" value={metrics.averageOpportunityScore} />
            <MetricCard label="Median Score" value={metrics.medianOpportunityScore} />
            <MetricCard label="Top Score" value={metrics.topOpportunityScore} />
            <MetricCard label="High Confidence" value={metrics.highConfidenceCount} />
            <MetricCard label="Newly Ranked" value={metrics.newOpportunityCount} />
            <MetricCard label="Upgraded" value={metrics.upgradedCount} sub="vs last scan" />
            <MetricCard label="Downgraded" value={metrics.downgradedCount} sub="vs last scan" />
            <MetricCard label="Improving Evidence" value={metrics.strengtheningCount} />
            <MetricCard label="Declining Evidence" value={metrics.weakeningCount} />
          </div>
        </section>
      )}

      {/* Coverage */}
      {metrics && (
        <section>
          <h2 className="text-sm font-semibold mb-3">Coverage</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-muted/40 rounded-lg p-3">
              <p className="text-xs text-muted-foreground">Technical Coverage</p>
              <p className="text-lg font-bold mt-0.5">
                {Math.round(metrics.technicalCoverage * 100)}%
              </p>
              <p className="text-xs text-muted-foreground/70 mt-0.5">
                {metrics.rankedSymbolCount} / {metrics.eligibleSymbolCount} eligible ranked
              </p>
            </div>
            <div className="bg-muted/40 rounded-lg p-3">
              <p className="text-xs text-muted-foreground">Institutional Coverage</p>
              <p className="text-lg font-bold mt-0.5">
                {Math.round(metrics.institutionalCoverage * 100)}%
              </p>
              <p className="text-xs text-muted-foreground/70 mt-0.5">
                {metrics.institutionalDataAvailableCount} with 13F data
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Institutional */}
      {metrics && metrics.institutionalDataAvailableCount > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-muted-foreground" /> Institutional Activity
          </h2>
          <div className="grid grid-cols-3 gap-3">
            <MetricCard label="Data Available" value={metrics.institutionalDataAvailableCount} />
            <MetricCard label="Accumulation Evidence" value={metrics.institutionalAccumulationCount} />
            <MetricCard label="Distribution Evidence" value={metrics.institutionalDistributionCount} />
          </div>
          <p className="text-xs text-muted-foreground/60 mt-2">
            Based on reported 13F holdings. Subject to filing delays.
          </p>
        </section>
      )}

      {/* Strengthening / Weakening */}
      {changes && (changes.strengtheningSymbols?.length > 0 || changes.weakeningSymbols?.length > 0) && (
        <section className="grid grid-cols-2 gap-4">
          {changes.strengtheningSymbols?.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-emerald-500" /> Strengthening
              </h2>
              <div className="flex flex-wrap gap-1">
                {changes.strengtheningSymbols.map(s => (
                  <Link key={s} href={`/opportunities/${s}`}>
                    <span className="text-xs px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded font-mono cursor-pointer hover:bg-emerald-200 dark:hover:bg-emerald-900/50">
                      {s}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
          {changes.weakeningSymbols?.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <TrendingDown className="w-4 h-4 text-orange-500" /> Weakening
              </h2>
              <div className="flex flex-wrap gap-1">
                {changes.weakeningSymbols.map(s => (
                  <Link key={s} href={`/opportunities/${s}`}>
                    <span className="text-xs px-1.5 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded font-mono cursor-pointer hover:bg-orange-200 dark:hover:bg-orange-900/50">
                      {s}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Top Symbols */}
      {data.topSymbols?.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" />
            Top Symbols ({data.topSymbols.length})
          </h2>
          <div className="space-y-1">
            {data.topSymbols.map(sym => <SymbolRow key={sym.symbol} sym={sym} />)}
          </div>
          <p className="text-xs text-muted-foreground/60 mt-2">
            Top symbols ranked by Opportunity Score from the Opportunity Ranking Engine. Click to open the Research Workspace.
          </p>
        </section>
      )}
    </div>
  );
}
