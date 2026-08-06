// RiskCard — Focused risk and invalidation display.
// Shows scanner warnings, invalidation condition, and high-impact market events.
// No AI-generated content. All items are deterministic from scanner output.

import { AlertTriangle, XCircle, Newspaper, CheckCircle2, Shield } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ResearchPackage, MarketSnapshot } from "./types";

// ---------------------------------------------------------------------------
// RiskCard
// ---------------------------------------------------------------------------

interface RiskCardProps {
  pkg: ResearchPackage;
  highImpactNews?: MarketSnapshot["topNews"];
}

export function RiskCard({ pkg, highImpactNews }: RiskCardProps) {
  const { candidate } = pkg;
  const news = (highImpactNews ?? []).slice(0, 2);

  const totalFlags =
    candidate.warnings.length +
    (candidate.invalidation ? 1 : 0) +
    news.length;

  return (
    <Card className="border-border/40" data-testid="risk-card">
      <CardHeader className="px-4 py-3 border-b border-border/30">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[12px] font-semibold uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
            <Shield className="h-3.5 w-3.5 text-amber-400" />
            Risk Summary
          </CardTitle>
          <span
            className={
              totalFlags === 0
                ? "text-[10px] text-emerald-400"
                : "text-[10px] text-amber-400"
            }
            data-testid="risk-flag-count"
          >
            {totalFlags === 0
              ? "No flags"
              : `${totalFlags} flag${totalFlags !== 1 ? "s" : ""}`}
          </span>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4 pt-3 space-y-2">
        {/* Clean state */}
        {totalFlags === 0 && (
          <div
            className="flex items-center gap-2 text-xs text-emerald-400"
            data-testid="risk-clean"
          >
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            No scanner warning flags for this candidate.
          </div>
        )}

        {/* Invalidation — most prominent */}
        {candidate.invalidation && (
          <div
            className="flex items-start gap-2 rounded border border-rose-500/25 bg-rose-500/8 px-3 py-2.5"
            data-testid="risk-invalidation"
          >
            <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0 mt-0.5" />
            <div className="text-xs space-y-0.5">
              <div className="font-semibold text-rose-300">Invalidation Level</div>
              <div className="text-muted-foreground leading-relaxed">
                Close below{" "}
                <span className="font-mono text-rose-300">${candidate.invalidation}</span>{" "}
                invalidates the setup. Educational planning only.
              </div>
            </div>
          </div>
        )}

        {/* Scanner warnings */}
        {candidate.warnings.map((warn, idx) => (
          <div
            key={idx}
            className="flex items-start gap-2 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2"
            data-testid={`risk-warning-${idx}`}
          >
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
            <span className="text-xs text-foreground/80 leading-relaxed">{warn}</span>
          </div>
        ))}

        {/* High-impact market events */}
        {news.map((n, idx) => (
          <div
            key={idx}
            className="flex items-start gap-2 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2"
            data-testid={`risk-news-${idx}`}
          >
            <Newspaper className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs space-y-0.5">
              <div className="font-medium text-foreground/80">
                Market Event · {n.symbol}
              </div>
              <div className="text-muted-foreground leading-relaxed">{n.whyItMatters}</div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
