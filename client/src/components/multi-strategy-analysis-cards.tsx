// Multi-strategy analysis rich cards for Ask AI ("Analyze MU").
// Renders ONLY the server's deterministic multiStrategyAnalysis payload —
// nothing here is computed or invented client-side. No-match/failed strategy
// detail lives in a collapsible advanced section so novices aren't
// overwhelmed by every negative result.

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Layers } from "lucide-react";
import {
  isRenderableMultiStrategyAnalysis,
  MSA_SUPPORT_GROUP_LABELS,
  MSA_VERDICT_LABELS,
  msaCandidateCheckLabel,
  msaFmtPrice,
  msaFreshLabel,
  msaIsIntraday,
  msaStatusLabel,
  msaStrategyName,
  msaSupportGroup,
  type MsaSetupEntry,
  type MsaSupportGroup,
  type MultiStrategyAnalysis,
} from "@/lib/multi-strategy-analysis";
import { translateNoTradeReason } from "@/lib/ranked-trade-search";

const VERDICT_TONE: Record<string, string> = {
  TRADE_CANDIDATE: "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
  WATCH: "border-sky-500/40 text-sky-300 bg-sky-500/10",
  NO_TRADE: "border-amber-500/40 text-amber-300 bg-amber-500/10",
  INSUFFICIENT_DATA: "border-muted text-muted-foreground bg-muted/20",
};

const CANDIDATE_TONE: Record<string, string> = {
  QUALIFIED: "text-emerald-300",
  NO_TRADE: "text-amber-300",
  WATCH: "text-sky-300",
  UNAVAILABLE: "text-muted-foreground",
};

const SUPPORT_GROUP_ORDER: MsaSupportGroup[] = ["confirming", "forming", "rejected", "unavailable"];

function SupportingRow({ entry }: { entry: MsaSetupEntry }) {
  const s = entry.setup;
  const checkLabel = msaCandidateCheckLabel(entry);
  const reason = entry.candidateCheck?.reason ?? (s.reasons ?? [])[0] ?? null;
  const intraday = msaIsIntraday(s);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs" data-testid={`row-msa-supporting-${s.strategy}`}>
      <span className="font-medium">{msaStrategyName(s)}</span>
      <span className="text-muted-foreground">— {msaStatusLabel(s.status)}</span>
      {intraday && (
        <Badge variant="outline" className="text-[9px] px-1 py-0" data-testid={`badge-msa-timeframe-${s.strategy}`}>
          {String(s.timeframe)} · intraday
        </Badge>
      )}
      {typeof s.score === "number" && <span className="text-muted-foreground">· score {Math.round(s.score)}</span>}
      {checkLabel && (
        <span className={CANDIDATE_TONE[entry.candidateCheck?.status ?? "UNAVAILABLE"] ?? "text-muted-foreground"}>
          · {checkLabel}
        </span>
      )}
      {!checkLabel && reason && <span className="text-muted-foreground/80 basis-full">{reason}</span>}
    </div>
  );
}

export function MultiStrategyAnalysisCards({ analysis }: { analysis: MultiStrategyAnalysis | null | undefined }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  if (!isRenderableMultiStrategyAnalysis(analysis)) return null;
  const a = analysis;
  const p = a.primarySetup ?? null;
  const ps = p?.setup;
  const noMatch = a.noMatchStrategies ?? [];
  const failed = a.failedStrategies ?? [];
  const hasAdvanced = noMatch.length > 0 || failed.length > 0;

  return (
    <div className="space-y-3" data-testid="cards-multi-strategy-analysis">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            {a.symbol} — Multi-Strategy Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={`text-[10px] ${VERDICT_TONE[a.overallVerdict] ?? ""}`} data-testid="badge-msa-verdict">
              Overall: {MSA_VERDICT_LABELS[a.overallVerdict] ?? a.overallVerdict}
            </Badge>
            <Badge variant="outline" className="text-[10px]" data-testid="badge-msa-checked">
              {a.strategiesChecked} strategies checked
            </Badge>
            <Badge variant="outline" className="text-[10px]" data-testid="badge-msa-matched">
              {a.strategiesMatched} match{a.strategiesMatched === 1 ? "" : "es"}
            </Badge>
            <Badge variant="outline" className="text-[10px]" data-testid="badge-msa-freshness">
              Data: {msaFreshLabel(a.dataQuality.fresh)}
            </Badge>
            {!a.dataQuality.realMarketData && a.strategiesMatched > 0 && (
              <Badge variant="outline" className="text-[10px] text-amber-300 border-amber-500/40 bg-amber-500/10">
                Non-live data
              </Badge>
            )}
          </div>

          {p && ps && (
            <div className="rounded-lg border p-3 space-y-2" data-testid="card-msa-primary">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{msaStrategyName(ps)}</span>
                <Badge variant="secondary" className="text-[10px]">{msaStatusLabel(ps.status)}</Badge>
                {ps.direction && <Badge variant="outline" className="text-[10px] capitalize">{ps.direction}</Badge>}
                {typeof ps.score === "number" && (
                  <Badge variant="outline" className="text-[10px]">Score {Math.round(ps.score)}</Badge>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                {msaFmtPrice(ps.trigger?.price) && (
                  <div><span className="text-muted-foreground">Trigger:</span> {msaFmtPrice(ps.trigger?.price)}</div>
                )}
                {msaFmtPrice(ps.invalidation?.price) && (
                  <div><span className="text-muted-foreground">Invalidation:</span> {msaFmtPrice(ps.invalidation?.price)}</div>
                )}
                {msaFmtPrice(ps.technicalObjective?.price) && (
                  <div><span className="text-muted-foreground">Objective:</span> {msaFmtPrice(ps.technicalObjective?.price)}</div>
                )}
              </div>
              {msaCandidateCheckLabel(p) && (
                <div className="text-xs" data-testid="text-msa-candidate-verdict">
                  <span className="text-muted-foreground">Candidate check:</span>{" "}
                  <span className={CANDIDATE_TONE[p.candidateCheck?.status ?? "UNAVAILABLE"] ?? ""}>
                    {msaCandidateCheckLabel(p)}
                  </span>
                  {/* §6 — Specific rejection reason chip. Maps the candidateCheck.reason
                      code (e.g. "WAITING_FOR_TRIGGER") to a trader-facing label. Only
                      shown when the reason matches a known code — prose reasons are
                      already shown in the "Why it's not actionable" section below. */}
                  {(a.overallVerdict === "NO_TRADE" || a.overallVerdict === "WATCH") &&
                    (() => {
                      const label = translateNoTradeReason(p.candidateCheck?.reason);
                      return label ? (
                        <Badge
                          variant="outline"
                          className="ml-1.5 text-[9px] border-amber-500/40 text-amber-300 bg-amber-500/10"
                          data-testid="badge-msa-no-trade-reason"
                        >
                          {label}
                        </Badge>
                      ) : null;
                    })()}
                </div>
              )}
              {(a.overallVerdict === "WATCH" || a.overallVerdict === "NO_TRADE") &&
                (p.candidateCheck?.reason || (p.candidateCheck?.warnings ?? []).length > 0) && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 space-y-1" data-testid="section-msa-not-actionable">
                    <div className="text-xs font-medium text-amber-300">Why it's not actionable</div>
                    <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                      {p.candidateCheck?.reason && <li>{p.candidateCheck.reason}</li>}
                      {(p.candidateCheck?.warnings ?? []).slice(0, 3).map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              {p.selectionReasons.length > 0 && (
                <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5" data-testid="list-msa-selection-reasons">
                  {p.selectionReasons.slice(0, 5).map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
              {(ps.warnings ?? []).length > 0 && (
                <div className="text-xs text-amber-300/90">{(ps.warnings ?? []).slice(0, 3).join(" · ")}</div>
              )}
            </div>
          )}

          {a.supportingSetups.length > 0 && (
            <div className="space-y-2" data-testid="list-msa-supporting">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Supporting evidence</div>
              {SUPPORT_GROUP_ORDER.map((group) => {
                const items = a.supportingSetups.filter((e) => msaSupportGroup(e) === group);
                if (items.length === 0) return null;
                return (
                  <div key={group} className="space-y-1" data-testid={`group-msa-supporting-${group}`}>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      {MSA_SUPPORT_GROUP_LABELS[group]}
                    </div>
                    {items.map((e, i) => (
                      <SupportingRow key={`${e.setup.strategy}-${i}`} entry={e} />
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {hasAdvanced && (
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                data-testid="button-msa-advanced-toggle"
              >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
                Advanced: strategies with no setup{failed.length > 0 ? " / unavailable" : ""}
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2 space-y-1 text-xs text-muted-foreground" data-testid="section-msa-advanced">
                {noMatch.length > 0 && <div>No current setup: {noMatch.join(", ")}</div>}
                {failed.length > 0 && (
                  <div>Temporarily unavailable: {failed.map((f) => f.strategy).join(", ")}</div>
                )}
              </CollapsibleContent>
            </Collapsible>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
