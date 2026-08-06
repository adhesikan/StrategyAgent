// CompactOptionsOverview — Overview-tab options structure summary.
// Sprint 2.2.1: new component; shows the primary illustrative options structure
// from the Trade Structure Engine output without duplicating the full Trade Planning tab.
//
// NEVER displays: premiums, Greeks, OI, bid/ask, expiration dates, probability of profit,
// fabricated maximum gain, or actual strike prices.
// All values are structural guidance only (DTE range + strike framework).
//
// If no appropriate options structure exists, renders an honest empty state.

import { CandlestickChart, ExternalLink, AlertTriangle, Link2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ResearchPackage, EvidenceStars } from "./types";
import { deriveThesis } from "./decision/research-decision-card";
import {
  deriveOptionsStructures,
  deriveDTE,
  deriveStrikeGuidance,
} from "./structure/options-structure-card";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CompactOptionsOverviewProps {
  pkg: ResearchPackage;
  stars: EvidenceStars;
  onNavigateTradePlanning: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CompactOptionsOverview({
  pkg,
  stars,
  onNavigateTradePlanning,
}: CompactOptionsOverviewProps) {
  const thesis = deriveThesis(pkg, stars);
  const structures = deriveOptionsStructures(pkg, thesis);
  const primary = structures[0] ?? null;

  const noStructureReason =
    thesis === "bearish"
      ? "No illustrative options structure generated — thesis is not directionally bullish."
      : pkg.marketRegime === "RISK_OFF"
      ? "No illustrative options structure generated — Risk-Off regime."
      : (() => {
          const strat = (pkg.candidate.strategy ?? "").toUpperCase();
          if (strat.includes("ORB") || strat.includes("GAP") || strat.includes("INTRADAY")) {
            return "No illustrative options structure generated — intraday strategy horizon is too short.";
          }
          return "No illustrative options structure was generated under the current planning rules.";
        })();

  if (!primary) {
    return (
      <Card className="border-border/40" data-testid="compact-options-overview">
        <CardHeader className="px-4 py-2.5 border-b border-border/30">
          <CardTitle className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <CandlestickChart className="h-3.5 w-3.5" aria-hidden="true" />
            Illustrative Options Structure
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 py-3">
          <p className="text-[12px] text-muted-foreground" data-testid="options-overview-empty">
            {noStructureReason}
          </p>
        </CardContent>
      </Card>
    );
  }

  const dte = deriveDTE(pkg.candidate);
  const longLeg = deriveStrikeGuidance(primary.name);
  // For spreads show both legs
  const isSpread = ["bull-call-spread", "call-debit-spread", "bull-put-spread", "iron-condor"].includes(primary.name);

  const rows: Array<{ label: string; value: string; testId: string }> = [
    { label: "Structure",       value: primary.label,                            testId: "opt-structure"  },
    { label: "Target Duration", value: dte,                                      testId: "opt-dte"        },
    { label: isSpread ? "Strike Framework" : "Strike Guidance", value: longLeg, testId: "opt-strike"     },
    { label: "Live Contracts",  value: "Broker verification required",           testId: "opt-live"       },
  ];

  return (
    <Card className="border-border/40" data-testid="compact-options-overview">
      <CardHeader className="px-4 py-2.5 border-b border-border/30">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <CandlestickChart className="h-3.5 w-3.5" aria-hidden="true" />
            Illustrative Options Structure
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {primary.isDefinedRisk && (
              <Badge
                variant="outline"
                className="text-[9px] border-emerald-500/30 text-emerald-400 bg-emerald-500/10"
              >
                Defined Risk
              </Badge>
            )}
            {primary.isIncome && (
              <Badge
                variant="outline"
                className="text-[9px] border-amber-500/30 text-amber-400 bg-amber-500/10"
              >
                Income
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 py-2.5 space-y-2.5">
        <dl className="space-y-0">
          {rows.map((row, i) => (
            <div
              key={row.testId}
              className={cn(
                "flex items-start justify-between py-1.5 text-[11px]",
                i < rows.length - 1 && "border-b border-border/15",
              )}
              data-testid={row.testId}
            >
              <dt className="text-muted-foreground/70 font-medium shrink-0 w-36">{row.label}</dt>
              <dd
                className={cn(
                  "font-medium text-right",
                  row.testId === "opt-live"
                    ? "text-amber-400/80"
                    : row.testId === "opt-structure"
                    ? "text-foreground"
                    : "text-foreground/80",
                )}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>

        {/* Disclaimer row */}
        <div className="flex items-start gap-1.5 rounded bg-amber-500/5 border border-amber-500/15 px-2.5 py-2">
          <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            No actual contracts, premiums, Greeks or expiration dates are shown. Illustrative guidance only.
          </p>
        </div>

        {/* Link to full Trade Planning tab */}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[11px] justify-start gap-1.5 text-muted-foreground hover:text-foreground px-1 w-full"
          onClick={onNavigateTradePlanning}
          data-testid="btn-options-trade-planning"
          aria-label="Open full Trade Planning tab for complete structure comparison"
        >
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          Full structure comparison in Trade Planning
        </Button>
      </CardContent>
    </Card>
  );
}
