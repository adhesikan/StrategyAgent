// /opportunities/changes — Opportunity Change Intelligence
//
// Dedicated full-view page for the opportunity change intelligence feed.
// Fixes Sprint 2.6.3 routing collision: this static route must be registered
// BEFORE /opportunities/:symbol so "changes" is never treated as a ticker symbol.
//
// Data: GET /api/opportunities/changes/explained (same endpoint used by dashboard)
// Each symbol links to /opportunities/:symbol (Opportunity Workspace v2).
// Reuses the same ChangeExplanation shape produced by the Change Intelligence Engine.
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
  TrendingDown,
  Minus,
  Plus,
  X,
  Clock,
  Activity,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types (mirror dashboard.tsx shape — same API /api/opportunities/changes/explained)
// ---------------------------------------------------------------------------

interface ChangeExplanation {
  symbol:       string;
  currentScore: number;
  scoreDelta:   number | null;
  rankDelta:    number | null;
  importance:   "Minor" | "Moderate" | "Major" | "Critical";
  summary:      string;
  drivers:      string[];
  direction:    "upgraded" | "downgraded" | "new" | "moved" | "unchanged" | "removed";
  category:     string;
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

function importanceBadge(imp: ChangeExplanation["importance"]): string {
  switch (imp) {
    case "Critical": return "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30";
    case "Major":    return "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30";
    case "Moderate": return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30";
    default:         return "bg-muted text-muted-foreground border-border";
  }
}

function directionIcon(dir: ChangeExplanation["direction"]) {
  switch (dir) {
    case "upgraded":   return <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />;
    case "downgraded": return <TrendingDown className="w-3.5 h-3.5 text-red-500" />;
    case "new":        return <Plus className="w-3.5 h-3.5 text-blue-500" />;
    case "removed":    return <X className="w-3.5 h-3.5 text-muted-foreground" />;
    default:           return <Minus className="w-3.5 h-3.5 text-muted-foreground" />;
  }
}

function directionLabel(dir: ChangeExplanation["direction"]): string {
  switch (dir) {
    case "upgraded":   return "Upgraded";
    case "downgraded": return "Downgraded";
    case "new":        return "New Entry";
    case "removed":    return "Removed";
    case "moved":      return "Moved";
    default:           return "Unchanged";
  }
}

function scoreDeltaClass(delta: number | null): string {
  if (delta == null) return "text-muted-foreground";
  if (delta > 0)     return "text-emerald-600 dark:text-emerald-400";
  if (delta < 0)     return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

// ---------------------------------------------------------------------------
// Change card
// ---------------------------------------------------------------------------

function ChangeCard({ exp }: { exp: ChangeExplanation }) {
  return (
    <Link href={`/opportunities/${exp.symbol}`}>
      <div className="rounded-lg border border-border/60 bg-card hover:bg-muted/30 cursor-pointer transition-colors p-3 space-y-1.5 group">
        <div className="flex items-start gap-2">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            {directionIcon(exp.direction)}
            <span className="font-mono text-sm font-semibold group-hover:text-primary">{exp.symbol}</span>
            <Badge
              variant="outline"
              className={cn("text-[10px] px-1.5 py-0 h-4 capitalize hidden sm:flex", importanceBadge(exp.importance))}
            >
              {exp.importance}
            </Badge>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {exp.scoreDelta != null && exp.scoreDelta !== 0 && (
              <span className={cn("text-xs tabular-nums font-semibold", scoreDeltaClass(exp.scoreDelta))}>
                {exp.scoreDelta > 0 ? "+" : ""}{exp.scoreDelta}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">{directionLabel(exp.direction)}</span>
            <ChevronRight className="w-3 h-3 text-muted-foreground group-hover:text-primary" />
          </div>
        </div>
        {exp.summary && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{exp.summary}</p>
        )}
        {exp.drivers.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {exp.drivers.slice(0, 3).map((d, i) => (
              <span key={i} className="text-[10px] bg-muted/60 rounded px-1.5 py-0.5 text-muted-foreground">{d}</span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

function ChangesSection({
  title,
  items,
  emptyText,
}: {
  title:     string;
  items:     ChangeExplanation[];
  emptyText: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{items.length}</Badge>
      </div>
      <div className="space-y-2">
        {items.map(exp => <ChangeCard key={exp.symbol} exp={exp} />)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function OpportunityChangesPage() {
  const [, setLocation] = useLocation();

  const { data, isPending, isError } = useQuery<ChangesResponse>({
    queryKey: ["/api/opportunities/changes/explained"],
    staleTime: 5 * 60 * 1000,
  });

  const freshness = data?.generatedAt;
  const totalChanges = data
    ? data.majorMovers.length + data.upgrades.length + data.downgrades.length +
      data.newEntries.length + data.removed.length
    : 0;

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
            <h1 className="text-sm font-semibold hidden sm:block">Change Intelligence</h1>
          </div>
          {freshness && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Updated {formatFreshness(freshness)}
            </span>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">

        {/* Page title */}
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            What Changed
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Research signal changes since the previous ranking cycle
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Changes reflect scoring updates only. They are not buy/sell signals or investment advice.
          </p>
        </div>

        {/* Loading */}
        {isPending && (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        )}

        {/* Error */}
        {isError && !isPending && (
          <Card className="border-destructive/30">
            <CardContent className="py-8 text-center space-y-2">
              <AlertCircle className="w-6 h-6 text-destructive/60 mx-auto" />
              <p className="text-sm text-muted-foreground">Could not load change data.</p>
              <Button variant="outline" size="sm" onClick={() => window.location.reload()}>Retry</Button>
            </CardContent>
          </Card>
        )}

        {/* Not available */}
        {!isPending && !isError && !data?.available && (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center space-y-2">
              <Activity className="w-7 h-7 text-muted-foreground/30 mx-auto" />
              <p className="text-sm font-medium text-muted-foreground">Change data not yet available</p>
              <p className="text-xs text-muted-foreground/70">
                {data?.message ?? "Requires at least two scan cycles to compute changes"}
              </p>
            </CardContent>
          </Card>
        )}

        {/* No changes */}
        {!isPending && !isError && data?.available && totalChanges === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center space-y-2">
              <Activity className="w-7 h-7 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-muted-foreground">No significant changes in this cycle</p>
            </CardContent>
          </Card>
        )}

        {/* Change sections */}
        {!isPending && !isError && data?.available && totalChanges > 0 && (
          <>
            <ChangesSection title="Major Movers" items={data.majorMovers} emptyText="" />
            <ChangesSection title="Upgrades" items={data.upgrades} emptyText="" />
            <ChangesSection title="New Entries" items={data.newEntries} emptyText="" />
            <ChangesSection title="Downgrades" items={data.downgrades} emptyText="" />
            <ChangesSection title="Removed" items={data.removed} emptyText="" />
          </>
        )}

        {/* Footer */}
        <p className="text-[10px] text-muted-foreground text-center pb-4">
          Change intelligence reflects score and rank movements between scan cycles.
          It is not investment advice. Past score changes do not predict future performance.
        </p>
      </div>
    </div>
  );
}
