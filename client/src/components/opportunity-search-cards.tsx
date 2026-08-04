import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Mini } from "@/components/radar-scenario-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TrendingUp, AlertTriangle, Info, Loader2, ClipboardList } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  SEARCH_TITLES,
  candidateStateLabel,
  resultCategoryLabel,
  countsSummaryLine,
  optionStrategyLabel,
  strikeZoneDisplay,
  cardCtas,
  prepareEligible,
  prepareTicketRequest,
  prepareTradeParams,
  type OpportunityCard,
  type LiveOptionCandidate,
  type OpportunitySearchResult,
} from "@/lib/opportunity-search";

/**
 * "Prepare in Trade Builder" — USER-INITIATED handoff only. Clicking asks the
 * backend to prepare a ticket prefill (prepare_trade_ticket when available,
 * otherwise the card's own displayed values), stores it as a draft, and
 * navigates to the Trade Builder. It never places an order and the Trade
 * Builder never opens without this explicit click.
 */
function PrepareTicketButton({ card }: { card: OpportunityCard }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [preparing, setPreparing] = useState(false);
  if (!prepareEligible(card)) return null;

  const onClick = async () => {
    const body = prepareTicketRequest(card);
    if (!body) return;
    setPreparing(true);
    try {
      const res = await apiRequest("POST", "/api/trade/prepare-ticket", body);
      const result = await res.json();
      if (!result?.ticket?.symbol) throw new Error("Empty ticket");
      const id = (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      sessionStorage.setItem(`tradeTicketPrefill:${id}`, JSON.stringify(result));
      const { type, strategy } = prepareTradeParams(card);
      navigate(`/trade/${card.symbol.toUpperCase()}?type=${type}&strategy=${strategy}&prefill=${id}`);
    } catch {
      toast({
        title: "Couldn't prepare the ticket",
        description: "You can still open the setup with View Setup and enter values manually.",
        variant: "destructive",
      });
    } finally {
      setPreparing(false);
    }
  };

  return (
    <Button
      size="sm"
      className="h-7 text-xs gap-1.5"
      disabled={preparing}
      onClick={onClick}
      data-testid={`button-opp-search-${card.symbol}-prepare-ticket`}
    >
      {preparing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ClipboardList className="h-3 w-3" />}
      Prepare in Trade Builder
    </Button>
  );
}

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

/** Truthful category badge tones — TRADE / WATCH / SETUP / NO TRADE / UNAVAILABLE. */
const CATEGORY_TONE: Record<string, string> = {
  ACTIONABLE_TRADE: "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
  WATCH: "border-amber-500/40 text-amber-300 bg-amber-500/10",
  SCANNER_SETUP: "border-sky-500/40 text-sky-300 bg-sky-500/10",
  REJECTED: "border-rose-500/40 text-rose-300 bg-rose-500/10",
  UNAVAILABLE: "border-muted-foreground/40 text-muted-foreground bg-muted/30",
};

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
  const countsLine = countsSummaryLine(search.counts);
  return (
    <div className="space-y-2" data-testid="cards-opportunity-search">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <TrendingUp className="h-3.5 w-3.5" /> {SEARCH_TITLES[search.type] ?? "Opportunities"}
      </div>
      {countsLine && (
        <div className="text-xs text-muted-foreground" data-testid="text-opp-search-counts">
          {countsLine}
        </div>
      )}
      {search.opportunities.map((o, i) => {
        const categoryLabel = resultCategoryLabel(o.resultCategory);
        // Legacy stored searches have no resultCategory — fall back to the
        // old candidate-state badge so nothing silently disappears.
        const stateLabel = categoryLabel ? null : candidateStateLabel(o.candidateState);
        const zone = o.estimatedOptions ? strikeZoneDisplay(o.estimatedOptions.shortStrikeZone) : null;
        const longZone = o.estimatedOptions ? strikeZoneDisplay(o.estimatedOptions.longStrikeZone) : null;
        return (
          <Card key={`${o.symbol}-${i}`} className="hover-elevate" data-testid={`card-opp-search-${o.symbol}`}>
            <CardContent className="p-4 space-y-3 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground tabular-nums">#{o.rank ?? i + 1}</span>
                  <span className="font-bold text-lg" data-testid={`text-opp-search-symbol-${o.symbol}`}>{o.symbol}</span>
                  {o.stage && (
                    <Badge variant="outline" className={cn("text-[10px] capitalize", STAGE_TONE[o.stage.toLowerCase()] ?? "")} data-testid={`badge-opp-search-stage-${o.symbol}`}>
                      {o.stage.replace(/-/g, " ")}
                    </Badge>
                  )}
                  {categoryLabel && (
                    <Badge
                      variant="outline"
                      className={cn("text-[10px]", CATEGORY_TONE[o.resultCategory ?? ""] ?? "")}
                      data-testid={`badge-opp-search-category-${o.symbol}`}
                    >
                      {categoryLabel}
                    </Badge>
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
                {o.strategy && (
                  <p className="text-xs mt-1 text-muted-foreground" data-testid={`text-opp-search-strategy-${o.symbol}`}>{o.strategy}</p>
                )}
              </div>
              {typeof o.score === "number" && (
                <div className="text-right shrink-0">
                  <div className="text-xs text-muted-foreground">Score</div>
                  <div className="text-2xl font-bold tabular-nums" data-testid={`text-opp-search-score-${o.symbol}`}>{o.score}</div>
                </div>
              )}
            </div>

            {(o.trigger != null || o.invalidation || o.technicalObjective || o.freshness) && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs" data-testid={`row-opp-search-levels-${o.symbol}`}>
                {o.trigger != null && <Mini label="Entry trigger" value={`$${o.trigger.toFixed(2)}`} testId={`mini-opp-trigger-${o.symbol}`} />}
                {o.invalidation && <Mini label="Invalidation" value={`$${o.invalidation.price.toFixed(2)}`} className="text-rose-300" testId={`mini-opp-invalidation-${o.symbol}`} />}
                {o.technicalObjective && <Mini label="Objective" value={`$${o.technicalObjective.price.toFixed(2)}`} className="text-emerald-300" testId={`mini-opp-objective-${o.symbol}`} />}
                {o.freshness && <Mini label="Freshness" value={o.freshness} testId={`mini-opp-freshness-${o.symbol}`} />}
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
              <PrepareTicketButton card={o} />
              {cardCtas(o, search.brokerConnected).map((c) => (
                <Link key={c.label} href={c.href}>
                  <Button size="sm" variant={c.primary ? "default" : "outline"} className="h-7 text-xs" data-testid={`button-opp-search-${o.symbol}-${c.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    {c.label}
                  </Button>
                </Link>
              ))}
            </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
