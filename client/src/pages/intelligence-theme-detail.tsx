// Theme Detail Page — Sprint 2.3.3
// Route: /intelligence/themes/:themeId
//
// Shows all intelligence signals for a single research theme.
// COMPLIANCE: No buy/sell/bullish/bearish language.

import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronRight,
  BarChart2,
  Info,
  Users,
  Activity,
  AlertCircle,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BreadthData {
  technicalBreadth:        number;
  technicalNumerator:      number;
  technicalDenominator:    number;
  institutionalBreadth:    number;
  institutionalNumerator:  number;
  institutionalDenominator: number;
  opportunityBreadth:      number;
  opportunityNumerator:    number;
  opportunityDenominator:  number;
}

interface ThemeMember {
  symbol:             string;
  overallScore:       number | null;
  technicalScore:     number | null;
  institutionalScore: number | null;
  confidence:         string | null;
  category:           string | null;
  isRanked:           boolean;
  changeDirection:    string | null;
}

interface DataQuality {
  technicalCoverage:     number;
  institutionalCoverage: number;
  classificationCoverage: number;
  confidence:            "high" | "moderate" | "limited";
}

interface ThemeDetailResponse {
  themeId:     string;
  themeName:   string;
  score:       number | null;
  label:       string;
  generatedAt: string | null;
  metrics: {
    memberCount:                     number;
    rankedMemberCount:               number;
    averageOpportunityScore:         number;
    medianOpportunityScore:          number;
    topOpportunityScore:             number;
    breadth:                         BreadthData;
    highConfidenceCount:             number;
    newOpportunityCount:             number;
    upgradedCount:                   number;
    downgradedCount:                 number;
    strengtheningCount:              number;
    weakeningCount:                  number;
    institutionalDataAvailableCount: number;
    institutionalAccumulationCount:  number;
    institutionalDistributionCount:  number;
    allMembers:                      ThemeMember[];
    description:                     string;
    dataQuality:                     DataQuality;
  };
  topSymbols: Array<{
    symbol:             string;
    overallScore:       number;
    technicalScore:     number;
    institutionalScore: number;
    confidence:         string;
    category:           string;
  }>;
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
        className={cn(
          "rounded-full transition-all",
          height,
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

function BreadthCard({ label, numerator, denominator, pct }: {
  label: string; numerator: number; denominator: number; pct: number;
}) {
  return (
    <div className="bg-muted/50 rounded-lg p-3">
      <p className="text-xs text-muted-foreground font-medium">{label}</p>
      <p className={cn("text-2xl font-bold tabular-nums mt-0.5",
        pct >= 75 ? "text-emerald-600 dark:text-emerald-400" :
        pct >= 50 ? "text-blue-600 dark:text-blue-400" :
        pct >= 25 ? "text-yellow-600 dark:text-yellow-400" :
        "text-muted-foreground"
      )}>
        {denominator > 0 ? `${pct}%` : "—"}
      </p>
      {denominator > 0 && (
        <p className="text-xs text-muted-foreground mt-0.5">{numerator} / {denominator}</p>
      )}
    </div>
  );
}

function ChangeDirectionBadge({ dir }: { dir: string | null }) {
  if (!dir) return null;
  const map: Record<string, { label: string; cls: string }> = {
    new:        { label: "New",       cls: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" },
    upgraded:   { label: "Improved",  cls: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400" },
    downgraded: { label: "Declined",  cls: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400" },
    moved:      { label: "Moved",     cls: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400" },
  };
  const info = map[dir];
  if (!info) return null;
  return (
    <span className={cn("text-xs px-1.5 py-0.5 rounded font-medium", info.cls)}>
      {info.label}
    </span>
  );
}

function SymbolRow({ member, linkToOpportunity = true }: { member: ThemeMember; linkToOpportunity?: boolean }) {
  const row = (
    <div className={cn(
      "flex items-center justify-between py-2 px-3 rounded-lg",
      member.isRanked ? "bg-muted/40 hover:bg-muted/70" : "opacity-60",
      linkToOpportunity && member.isRanked ? "cursor-pointer" : "",
    )}>
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm font-medium">{member.symbol}</span>
        <ChangeDirectionBadge dir={member.changeDirection} />
        {!member.isRanked && (
          <span className="text-xs text-muted-foreground">Not ranked</span>
        )}
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {member.overallScore != null && (
          <span className="tabular-nums font-medium text-foreground">{member.overallScore}</span>
        )}
        {member.confidence && (
          <span className={cn(
            "capitalize",
            member.confidence === "high" ? "text-emerald-600 dark:text-emerald-400" :
            member.confidence === "medium" ? "text-blue-600 dark:text-blue-400" : "",
          )}>{member.confidence}</span>
        )}
        {member.category && <span className="hidden sm:inline">{member.category}</span>}
        {linkToOpportunity && member.isRanked && (
          <ChevronRight className="w-3 h-3" />
        )}
      </div>
    </div>
  );

  if (linkToOpportunity && member.isRanked) {
    return <Link href={`/opportunities/${member.symbol}`}>{row}</Link>;
  }
  return row;
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function IntelligenceThemeDetailPage() {
  const { themeId } = useParams<{ themeId: string }>();

  const query = useQuery<ThemeDetailResponse>({
    queryKey: [`/api/intelligence/themes/${themeId}`],
    enabled: !!themeId,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });

  const data = query.data;
  const metrics = data?.metrics;
  const breadth = metrics?.breadth;
  const changes = data?.changes;
  const quality = metrics?.dataQuality;
  const allMembers = metrics?.allMembers ?? [];

  const strengthening = allMembers.filter(m => m.changeDirection === "upgraded" || m.changeDirection === "new");
  const weakening     = allMembers.filter(m => m.changeDirection === "downgraded");
  const instAccum     = allMembers.filter(m => m.isRanked && (m.institutionalScore ?? 0) >= 60);
  const notRanked     = allMembers.filter(m => !m.isRanked);

  if (query.isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-3 gap-3">
          {[0,1,2].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-64 w-full" />
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
            {query.error instanceof Error ? query.error.message : "No snapshot available for this theme yet. Intelligence data is computed after each scan cycle."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const scoreDelta = changes?.scoreDelta;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

      {/* Back */}
      <Link href="/intelligence">
        <Button variant="ghost" size="sm">
          <ArrowLeft className="w-4 h-4 mr-1" /> Sector & Theme Intelligence
        </Button>
      </Link>

      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold">{data.themeName}</h1>
            {metrics?.description && (
              <p className="text-sm text-muted-foreground mt-1 max-w-xl">{metrics.description}</p>
            )}
          </div>
          <div className="text-right">
            {data.score != null && (
              <p className={cn("text-4xl font-black tabular-nums", labelColor(data.label))}>
                {data.score}
              </p>
            )}
            <p className={cn("text-sm font-semibold", labelColor(data.label))}>{data.label}</p>
            {scoreDelta != null && (
              <p className={cn("text-xs mt-0.5", scoreDelta >= 0 ? "text-emerald-600" : "text-red-600")}>
                {scoreDelta >= 0 ? "+" : ""}{scoreDelta} vs last scan
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
          <span>{metrics?.memberCount ?? 0} members</span>
          <span>{metrics?.rankedMemberCount ?? 0} currently ranked</span>
          {quality && (
            <span className={cn("capitalize",
              quality.confidence === "high" ? "text-emerald-600" :
              quality.confidence === "moderate" ? "text-blue-600" : "text-muted-foreground",
            )}>{quality.confidence} confidence</span>
          )}
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
        <AlertDescription className="text-xs text-muted-foreground">
          {data.disclaimer}
        </AlertDescription>
      </Alert>

      {/* Change summary */}
      {changes?.summary && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm">{changes.summary}</p>
            {changes.newLeaders?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                <span className="text-xs text-muted-foreground">New in top positions:</span>
                {changes.newLeaders.map(s => (
                  <span key={s} className="text-xs px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded font-mono">{s}</span>
                ))}
              </div>
            )}
            {changes.lostLeaders?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                <span className="text-xs text-muted-foreground">Left top positions:</span>
                {changes.lostLeaders.map(s => (
                  <span key={s} className="text-xs px-1.5 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded font-mono">{s}</span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Breadth */}
      {breadth && (
        <section>
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-muted-foreground" /> Breadth
          </h2>
          <div className="grid grid-cols-3 gap-3">
            <BreadthCard
              label="Opportunity Breadth"
              numerator={breadth.opportunityNumerator}
              denominator={breadth.opportunityDenominator}
              pct={breadth.opportunityBreadth}
            />
            <BreadthCard
              label="Technical Breadth"
              numerator={breadth.technicalNumerator}
              denominator={breadth.technicalDenominator}
              pct={breadth.technicalBreadth}
            />
            <BreadthCard
              label="Institutional Breadth"
              numerator={breadth.institutionalNumerator}
              denominator={breadth.institutionalDenominator}
              pct={breadth.institutionalBreadth}
            />
          </div>
          <p className="text-xs text-muted-foreground/60 mt-2">
            Technical breadth: % of ranked members with technical score ≥ 65.
            Institutional breadth: % of members with accumulation evidence in 13F data.
            Opportunity breadth: % of theme members currently ranked.
          </p>
        </section>
      )}

      {/* Top Opportunities */}
      {data.topSymbols?.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" /> Top Opportunities
          </h2>
          <div className="space-y-1">
            {data.topSymbols.map(sym => (
              <SymbolRow
                key={sym.symbol}
                member={{
                  symbol:             sym.symbol,
                  overallScore:       sym.overallScore,
                  technicalScore:     sym.technicalScore,
                  institutionalScore: sym.institutionalScore,
                  confidence:         sym.confidence,
                  category:           sym.category,
                  isRanked:           true,
                  changeDirection:    null,
                }}
              />
            ))}
          </div>
        </section>
      )}

      {/* Strengthening */}
      {strengthening.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-500" />
            Strengthening ({strengthening.length})
          </h2>
          <div className="space-y-1">
            {strengthening.map(m => <SymbolRow key={m.symbol} member={m} />)}
          </div>
        </section>
      )}

      {/* Weakening */}
      {weakening.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-orange-500" />
            Weakening ({weakening.length})
          </h2>
          <div className="space-y-1">
            {weakening.map(m => <SymbolRow key={m.symbol} member={m} />)}
          </div>
        </section>
      )}

      {/* Institutional Activity */}
      {metrics && metrics.institutionalDataAvailableCount > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-muted-foreground" />
            Institutional Activity
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div className="bg-muted/40 rounded-lg p-3">
              <p className="text-xs text-muted-foreground">Data Available</p>
              <p className="text-xl font-bold mt-0.5">{metrics.institutionalDataAvailableCount}</p>
            </div>
            <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-3">
              <p className="text-xs text-muted-foreground">Accumulation Evidence</p>
              <p className="text-xl font-bold mt-0.5 text-emerald-700 dark:text-emerald-400">
                {metrics.institutionalAccumulationCount}
              </p>
            </div>
            <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3">
              <p className="text-xs text-muted-foreground">Distribution Evidence</p>
              <p className="text-xl font-bold mt-0.5 text-orange-700 dark:text-orange-400">
                {metrics.institutionalDistributionCount}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground/60 mt-2">
            Based on reported 13F holdings data. Subject to filing delays.
          </p>
        </section>
      )}

      {/* Recent Changes */}
      {changes && (changes.newLeaders?.length > 0 || changes.lostLeaders?.length > 0 ||
        changes.strengtheningSymbols?.length > 0 || changes.weakeningSymbols?.length > 0) && (
        <section>
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" /> Recent Changes
          </h2>
          <div className="space-y-2 text-sm">
            {changes.newLeaders?.length > 0 && (
              <div className="flex items-start gap-2">
                <span className="text-xs text-muted-foreground w-32 flex-shrink-0">New in top 5:</span>
                <div className="flex flex-wrap gap-1">
                  {changes.newLeaders.map(s => (
                    <span key={s} className="text-xs px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded font-mono">{s}</span>
                  ))}
                </div>
              </div>
            )}
            {changes.lostLeaders?.length > 0 && (
              <div className="flex items-start gap-2">
                <span className="text-xs text-muted-foreground w-32 flex-shrink-0">Left top 5:</span>
                <div className="flex flex-wrap gap-1">
                  {changes.lostLeaders.map(s => (
                    <span key={s} className="text-xs px-1.5 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded font-mono">{s}</span>
                  ))}
                </div>
              </div>
            )}
            {changes.strengtheningSymbols?.length > 0 && (
              <div className="flex items-start gap-2">
                <span className="text-xs text-muted-foreground w-32 flex-shrink-0">Improving:</span>
                <div className="flex flex-wrap gap-1">
                  {changes.strengtheningSymbols.map(s => (
                    <span key={s} className="text-xs px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded font-mono">{s}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* All Members */}
      <section>
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          All Members ({allMembers.length})
        </h2>
        <div className="space-y-1">
          {allMembers.map(m => <SymbolRow key={m.symbol} member={m} />)}
        </div>
        {notRanked.length > 0 && (
          <p className="text-xs text-muted-foreground/60 mt-2">
            {notRanked.length} member{notRanked.length !== 1 ? "s" : ""} not in current ranking.
          </p>
        )}
      </section>
    </div>
  );
}
