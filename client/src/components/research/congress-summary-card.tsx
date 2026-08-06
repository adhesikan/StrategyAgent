// CongressSummaryCard — Congressional disclosure summary for the Overview tab.
// Sprint 2.2.1: new component; makes congressional evidence more visible without
// implying predictive power.
//
// Displays the evidence signal level (from EvidenceStars) — does NOT fabricate
// disclosure counts, politician names, or transaction amounts.
// If only signal level is available, shows signal level + link to Congress tab.
//
// Disclaimer is always present and prominent.

import { Landmark, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { EvidenceStars } from "./types";
import { evidenceSignalLabel, evidenceSignalTextClass } from "./evidence-card";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CongressSummaryCardProps {
  stars: EvidenceStars;
  symbol: string;
  onNavigateCongress: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map congress stars (1–5) to a factual activity label. */
export function congressActivityLabel(stars: number): string {
  if (stars <= 0) return "No disclosures in current evidence window";
  if (stars >= 4) return "Active disclosures present";
  if (stars >= 3) return "Moderate disclosure activity";
  if (stars >= 2) return "Limited disclosure activity";
  return "Minimal activity in evidence window";
}

/** Map congress stars to a badge color class. */
export function congressBadgeClass(stars: number): string {
  if (stars === 0) return "text-muted-foreground border-border/40 bg-muted/20";
  if (stars >= 4) return "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
  if (stars >= 3) return "text-sky-400 border-sky-500/30 bg-sky-500/10";
  if (stars >= 2) return "text-amber-400 border-amber-500/30 bg-amber-500/10";
  return "text-muted-foreground/70 border-border/40";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CongressSummaryCard({
  stars,
  symbol,
  onNavigateCongress,
}: CongressSummaryCardProps) {
  const activityLabel = congressActivityLabel(stars.congress);
  const signalLabel = evidenceSignalLabel(stars.congress);
  const textClass = evidenceSignalTextClass(stars.congress);
  const badgeClass = congressBadgeClass(stars.congress);
  // congress is typed 1–5; treat score of 1 as minimal/no meaningful data
  const isUnavailable = (stars.congress as number) <= 1;

  return (
    <Card className="border-border/40" data-testid="congress-summary-card">
      <CardHeader className="px-4 py-2.5 border-b border-border/30">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Landmark className="h-3.5 w-3.5" aria-hidden="true" />
            Congressional Disclosures
          </CardTitle>
          <Badge
            variant="outline"
            className={cn("text-[10px] font-semibold border", badgeClass)}
            data-testid="congress-badge"
          >
            {signalLabel}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="px-4 py-3 space-y-2.5">
        {/* Signal level row */}
        <div
          className="flex items-center justify-between text-[12px]"
          data-testid="congress-activity-label"
        >
          <span className="text-muted-foreground">Evidence Assessment</span>
          <span className={cn("font-medium", isUnavailable ? "text-muted-foreground/50" : textClass)}>
            {isUnavailable ? "Not available" : activityLabel}
          </span>
        </div>

        {/* Factual signal label */}
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-muted-foreground">Signal Level</span>
          <span className={cn("font-medium", isUnavailable ? "text-muted-foreground/50" : textClass)}>
            {signalLabel}
          </span>
        </div>

        {/* Disclaimer — always visible */}
        <div
          className="rounded bg-muted/20 border border-border/20 px-2.5 py-2"
          data-testid="congress-disclaimer"
        >
          <p className="text-[10px] text-muted-foreground/80 leading-relaxed">
            Publicly disclosed congressional transactions for{" "}
            <span className="font-medium text-foreground/60">{symbol}</span>.
            Disclosure dates may lag transaction dates by up to 45 days.
            Congressional disclosures do not indicate future performance and
            are presented for educational context only.
          </p>
        </div>

        {/* Link to Congress tab */}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[11px] justify-start gap-1.5 text-muted-foreground hover:text-foreground px-1 w-full"
          onClick={onNavigateCongress}
          data-testid="btn-congress-detail"
          aria-label="Open congressional disclosure detail tab"
        >
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          {isUnavailable ? "Check Congress tab for latest data" : "View disclosure detail"}
        </Button>
      </CardContent>
    </Card>
  );
}
