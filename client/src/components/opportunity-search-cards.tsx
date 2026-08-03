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
  type LiveOptionCandidate,
  type OpportunitySearchResult,
} from "@/lib/opportunity-search";

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtMaybe(n: number | null | undefined, digits = 2): string {
  return typeof n === "number" ? n.toFixed(digits) : "—";
}

/** LIVE OPTION CANDIDATE — full contract detail from the live chain. */
function LiveOptionBox({ symbol, live }: { symbol: string; live: LiveOptionCandidate }) {
  const debitOrCredit = `${live.netKind === "credit" ? "Est. credit" : "Est. debit"} ${fmtUsd(Math.abs(live.estimatedNet))}/contract (${fmtUsd(Math.abs(live.estimatedNet) * 100)})`;
  return (
    <div className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-2 text-xs space-y-1.5" data-testid={`box-live-options-${symbol}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium">{optionStrategyLabel(live.strategy)}</span>
        <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300 bg-emerald-500/10">Live contracts</Badge>
        <span className="text-muted-foreground tabular-nums">
          Exp {live.expiration}
          {live.dte != null && <> · {live.dte} DTE</>}
        </span>
      </div>
      <div className="space-y-0.5">
        {live.legs.map((l, i) => (
          <div key={i} className="flex gap-2 flex-wrap tabular-nums" data-testid={`row-live-leg-${symbol}-${i}`}>
            <span className={l.action === "buy" ? "text-emerald-300 font-medium" : "text-rose-300 font-medium"}>
              {l.action.toUpperCase()}
            </span>
            <span>{fmtUsd(l.strike)} {l.type}</span>
            <span className="text-muted-foreground">
              {l.bid != null && l.ask != null
                ? <>bid {fmtMaybe(l.bid)} / ask {fmtMaybe(l.ask)}</>
                : <>mid {fmtMaybe(l.mid)}</>}
            </span>
            {(l.delta != null || l.theta != null || l.iv != null) && (
              <span className="text-muted-foreground">
                {l.delta != null && <>Δ {fmtMaybe(l.delta)} </>}
                {l.theta != null && <>Θ {fmtMaybe(l.theta)} </>}
                {l.iv != null && <>IV {(l.iv * (l.iv < 3 ? 100 : 1)).toFixed(0)}%</>}
              </span>
            )}
            {(l.volume != null || l.openInterest != null) && (
              <span className="text-muted-foreground">
                {l.volume != null && <>Vol {l.volume.toLocaleString()} </>}
                {l.openInterest != null && <>OI {l.openInterest.toLocaleString()}</>}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="text-muted-foreground">
        {live.priceBasis === "mid" ? "Premiums are midpoint assumptions" : "Premiums from live bid/ask"} · {debitOrCredit}
      </div>
      <div className="flex gap-3 flex-wrap tabular-nums" data-testid={`row-live-risk-${symbol}`}>
        {live.maxLoss != null && <span className="text-rose-300">Max loss {fmtUsd(live.maxLoss)}</span>}
        {live.maxProfit != null && <span className="text-emerald-300">Max profit {fmtUsd(live.maxProfit)}</span>}
        {live.breakeven && live.breakeven.length > 0 && (
          <span className="text-muted-foreground">Breakeven {live.breakeven.map((b) => fmtUsd(b)).join(" / ")}</span>
        )}
        {live.liquidityQuality && <span className="text-muted-foreground capitalize">Liquidity: {live.liquidityQuality}</span>}
      </div>
      {live.liquidityNotes && live.liquidityNotes.length > 0 && (
        <div className="text-muted-foreground">{live.liquidityNotes.join(" · ")}</div>
      )}
      {live.rankReasons.length > 0 && (
        <ul className="space-y-0.5">
          {live.rankReasons.map((r, i) => (
            <li key={i} className="text-muted-foreground break-words">• {r}</li>
          ))}
        </ul>
      )}
      {live.warnings && live.warnings.length > 0 && (
        <div className="text-amber-200/90 flex items-start gap-1.5">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span className="break-words">{live.warnings.join(" · ")}</span>
        </div>
      )}
    </div>
  );
}

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
        const longZone = o.estimatedOptions ? strikeZoneDisplay(o.estimatedOptions.longStrikeZone) : null;
        return (
          <div key={`${o.symbol}-${i}`} className="rounded-lg border p-3 space-y-2 min-w-0" data-testid={`card-opp-search-${o.symbol}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground tabular-nums">{o.rank ?? i + 1}.</span>
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

            {(o.trigger != null || o.invalidation || o.technicalObjective || o.freshness) && (
              <div className="text-xs text-muted-foreground flex gap-3 flex-wrap" data-testid={`row-opp-search-levels-${o.symbol}`}>
                {o.trigger != null && <span className="tabular-nums">Entry trigger: ${o.trigger.toFixed(2)}</span>}
                {o.invalidation && <span className="tabular-nums">Invalidation: ${o.invalidation.price.toFixed(2)}</span>}
                {o.technicalObjective && <span className="tabular-nums">Objective: ${o.technicalObjective.price.toFixed(2)}</span>}
                {o.freshness && <span>{o.freshness}</span>}
              </div>
            )}

            {o.riskEstimate && o.riskEstimate.suggestedMaxShares != null && (
              <div className="text-xs text-muted-foreground" data-testid={`row-opp-search-risk-${o.symbol}`}>
                Risk sizing: up to {o.riskEstimate.suggestedMaxShares} share{o.riskEstimate.suggestedMaxShares === 1 ? "" : "s"}
                {o.riskEstimate.maxRiskDollars != null && <> within a ${o.riskEstimate.maxRiskDollars.toFixed(0)} budget</>}
                {o.riskEstimate.riskPerShare != null && <> · ${o.riskEstimate.riskPerShare.toFixed(2)}/share at the stop</>}
              </div>
            )}

            {o.liveOption && <LiveOptionBox symbol={o.symbol} live={o.liveOption} />}

            {!o.liveOption && o.estimatedOptions && (
              <div className="rounded-md border border-violet-500/20 bg-violet-500/5 p-2 text-xs space-y-1" data-testid={`box-estimated-options-${o.symbol}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{optionStrategyLabel(o.estimatedOptions.strategy)}</span>
                  <Badge variant="outline" className="text-[10px] border-violet-500/40 text-violet-300 bg-violet-500/10">Estimated — not a live trade</Badge>
                  {o.estimatedOptions.riskStyle && (
                    <Badge variant="outline" className="text-[10px] capitalize">{o.estimatedOptions.riskStyle}</Badge>
                  )}
                </div>
                <div className="text-muted-foreground">
                  Target DTE: {o.estimatedOptions.targetDteMin}–{o.estimatedOptions.targetDteMax}
                  {zone ? <> · Short strike zone: {zone}</> : null}
                  {longZone ? <> · Long strike zone: {longZone}</> : null}
                </div>
                {(o.trigger != null || o.technicalObjective) && (
                  <div className="text-muted-foreground tabular-nums">
                    {o.trigger != null && <>Underlying trigger: ${o.trigger.toFixed(2)}</>}
                    {o.trigger != null && o.technicalObjective && <> · </>}
                    {o.technicalObjective && <>Technical objective: ${o.technicalObjective.price.toFixed(2)}</>}
                  </div>
                )}
                {o.estimatedOptions.limitations && o.estimatedOptions.limitations.length > 0 && (
                  <ul className="space-y-0.5 text-muted-foreground" data-testid={`list-estimated-limitations-${o.symbol}`}>
                    {o.estimatedOptions.limitations.map((l, j) => (
                      <li key={j} className="break-words">• {l}</li>
                    ))}
                  </ul>
                )}
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
