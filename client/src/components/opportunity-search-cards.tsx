import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TrendingUp, AlertTriangle, Info } from "lucide-react";
import {
  SEARCH_TITLES,
  candidateStateLabel,
  optionStrategyLabel,
  strikeZoneDisplay,
  cardCtas,
  type OpportunitySearchResult,
} from "@/lib/opportunity-search";

const STAGE_TONE: Record<string, string> = {
  "pivot-ready": "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
  contraction: "border-sky-500/40 text-sky-300 bg-sky-500/10",
  developing: "border-indigo-500/40 text-indigo-300 bg-indigo-500/10",
  early: "border-amber-500/40 text-amber-300 bg-amber-500/10",
};

/**
 * Ranked opportunity cards for deterministic Ask AI opportunity searches.
 * Renders ONLY backend-supplied fields; estimated options are labeled as
 * such and never show premiums/Greeks (the backend never sends them).
 */
export function OpportunitySearchCards({ search }: { search: OpportunitySearchResult }) {
  if (!search || !Array.isArray(search.opportunities) || search.opportunities.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="cards-opportunity-search">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <TrendingUp className="h-3.5 w-3.5" /> {SEARCH_TITLES[search.type] ?? "Opportunities"}
      </div>
      {search.opportunities.map((o, i) => {
        const stateLabel = candidateStateLabel(o.candidateState);
        const zone = o.estimatedOptions ? strikeZoneDisplay(o.estimatedOptions.shortStrikeZone) : null;
        return (
          <div key={`${o.symbol}-${i}`} className="rounded-lg border p-3 space-y-2 min-w-0" data-testid={`card-opp-search-${o.symbol}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
              <span className="font-mono font-medium">{o.symbol}</span>
              {o.strategy && <span className="text-xs text-muted-foreground">{o.strategy}</span>}
              {o.stage && (
                <Badge variant="outline" className={cn("text-[10px] capitalize", STAGE_TONE[o.stage.toLowerCase()] ?? "")} data-testid={`badge-opp-search-stage-${o.symbol}`}>
                  {o.stage.replace(/-/g, " ")}
                </Badge>
              )}
              {typeof o.score === "number" && (
                <Badge variant="outline" className="text-[10px] tabular-nums">{o.score}/100</Badge>
              )}
              {stateLabel && (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px]",
                    o.candidateState === "no_trade"
                      ? "border-rose-500/40 text-rose-300 bg-rose-500/10"
                      : "border-violet-500/40 text-violet-300 bg-violet-500/10",
                  )}
                  data-testid={`badge-opp-search-state-${o.symbol}`}
                >
                  {stateLabel}
                </Badge>
              )}
            </div>

            {(o.trigger != null || o.freshness) && (
              <div className="text-xs text-muted-foreground flex gap-3 flex-wrap">
                {o.trigger != null && <span className="tabular-nums">Entry trigger: ${o.trigger.toFixed(2)}</span>}
                {o.freshness && <span>{o.freshness}</span>}
              </div>
            )}

            {o.estimatedOptions && (
              <div className="rounded-md border border-violet-500/20 bg-violet-500/5 p-2 text-xs space-y-1" data-testid={`box-estimated-options-${o.symbol}`}>
                <div className="font-medium">{optionStrategyLabel(o.estimatedOptions.strategy)} · Estimated</div>
                <div className="text-muted-foreground">
                  Target DTE: {o.estimatedOptions.targetDteMin}–{o.estimatedOptions.targetDteMax}
                  {zone ? <> · Strike zone: {zone}</> : null}
                </div>
                {o.estimatedOptions.connectionRequiredForLiveContracts && (
                  <div className="flex items-start gap-1.5 text-amber-200/90">
                    <Info className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>Connect Tradier or TradeStation to evaluate live contracts, premiums, Greeks and liquidity.</span>
                  </div>
                )}
              </div>
            )}

            {o.reasons.length > 0 && (
              <ul className="text-xs space-y-0.5">
                {o.reasons.map((r, j) => (
                  <li key={j} className="text-muted-foreground break-words">• {r}</li>
                ))}
              </ul>
            )}
            {o.warnings.length > 0 && (
              <div className="text-xs text-amber-200/90 flex items-start gap-1.5">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                <span className="break-words">{o.warnings.join(" · ")}</span>
              </div>
            )}

            <div className="flex gap-1.5 flex-wrap">
              {cardCtas(o, search.brokerConnected).map((c) => (
                <Link key={c.label} href={c.href}>
                  <Button size="sm" variant={c.primary ? "default" : "outline"} className="h-7 text-xs" data-testid={`button-opp-search-${o.symbol}-${c.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    {c.label}
                  </Button>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
