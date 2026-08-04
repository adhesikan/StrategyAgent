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
  MSA_VERDICT_LABELS,
  msaFmtPrice,
  msaFreshLabel,
  msaStatusLabel,
  msaStrategyName,
  type MsaSetupEntry,
  type MultiStrategyAnalysis,
} from "@/lib/multi-strategy-analysis";

const VERDICT_TONE: Record<string, string> = {
  TRADE_CANDIDATE: "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
  WATCH: "border-sky-500/40 text-sky-300 bg-sky-500/10",
  NO_TRADE: "border-amber-500/40 text-amber-300 bg-amber-500/10",
  INSUFFICIENT_DATA: "border-muted text-muted-foreground bg-muted/20",
};

function candidateVerdictLabel(entry: MsaSetupEntry): string | null {
  const v = entry.candidate?.verdict;
  if (!v) return entry.candidate === null ? "Candidate check unavailable" : null;
  const u = String(v).toUpperCase();
  if (u === "NO_TRADE") return "No qualified trade";
  if (u === "STOCK") return "Qualified: stock trade";
  if (u === "LIVE_OPTIONS") return "Qualified: live options";
  if (u === "ESTIMATED_OPTIONS") return "Qualified: options (estimated)";
  return u;
}

function SupportingRow({ entry }: { entry: MsaSetupEntry }) {
  const s = entry.setup;
  const verdict = candidateVerdictLabel(entry);
  const reason = (s.reasons ?? [])[0] ?? null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs" data-testid={`row-msa-supporting-${s.strategy}`}>
      <span className="font-medium">{msaStrategyName(s)}</span>
      <span className="text-muted-foreground">— {msaStatusLabel(s.status)}</span>
      {typeof s.score === "number" && <span className="text-muted-foreground">· score {Math.round(s.score)}</span>}
      {verdict && <span className="text-muted-foreground">· {verdict}</span>}
      {reason && <span className="text-muted-foreground/80 basis-full">{reason}</span>}
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
              {candidateVerdictLabel(p) && (
                <div className="text-xs" data-testid="text-msa-candidate-verdict">
                  <span className="text-muted-foreground">Candidate check:</span> {candidateVerdictLabel(p)}
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
            <div className="space-y-1.5" data-testid="list-msa-supporting">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Supporting evidence</div>
              {a.supportingSetups.map((e, i) => (
                <SupportingRow key={`${e.setup.strategy}-${i}`} entry={e} />
              ))}
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
