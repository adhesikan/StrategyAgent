// Multi-strategy analysis rich cards for Ask AI ("Analyze MU").
// Renders ONLY the server's deterministic multiStrategyAnalysis payload —
// nothing here is computed or invented client-side. No-match/failed strategy
// detail lives in a collapsible advanced section so novices aren't
// overwhelmed by every negative result.

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Layers, AlertTriangle } from "lucide-react";
import {
  isRenderableMultiStrategyAnalysis,
  MSA_SUPPORT_GROUP_LABELS,
  MSA_VERDICT_LABELS,
  msaCandidateCheckLabel,
  msaFmtPrice,
  msaFreshLabel,
  msaIsIntraday,
  msaStatusBadge,
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

// ---------------------------------------------------------------------------
// Price integrity warning banner
// ---------------------------------------------------------------------------

function IntegrityWarning({ symbol }: { symbol: string }) {
  return (
    <div
      className="flex flex-col gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/8 px-3 py-2.5"
      data-testid="banner-price-integrity-failed"
    >
      <div className="flex items-center gap-2 text-xs font-medium text-amber-300">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        Price levels could not be validated
      </div>
      <p className="text-xs text-muted-foreground">
        Entry confirmation, risk reference, and research objective levels have been withheld for {symbol}. This analysis cannot be saved until price data is restored.
      </p>
      <div className="flex gap-2 text-[10px]">
        <a href={`/ask?q=analyze+${symbol}`} className="text-amber-300/80 hover:text-amber-300 underline underline-offset-2">
          Retry Analysis
        </a>
        <span className="text-muted-foreground">·</span>
        <a href={`/charts/${symbol}`} className="text-muted-foreground hover:text-foreground underline underline-offset-2">
          Open Chart
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Strategy count breakdown (spec §5)
// ---------------------------------------------------------------------------

function CountBreakdown({ a }: { a: MultiStrategyAnalysis }) {
  const confirming = a.confirmingCount ?? 0;
  const forming = a.formingCount ?? 0;
  const rejected = a.rejectedCount ?? 0;
  const unavailable = a.unavailableCount ?? 0;
  const evaluated = a.strategiesChecked;
  const failed = a.strategiesFailed;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="section-msa-counts">
      <Badge variant="outline" className="text-[10px]" data-testid="badge-msa-evaluated">
        {evaluated} {evaluated === 1 ? "strategy" : "strategies"} evaluated
      </Badge>
      {failed > 0 && (
        <Badge variant="outline" className="text-[10px] text-muted-foreground" data-testid="badge-msa-failed">
          {failed} not available
        </Badge>
      )}
      {confirming > 0 && (
        <Badge variant="outline" className="text-[10px] text-emerald-300 border-emerald-500/40 bg-emerald-500/10" data-testid="badge-msa-confirming">
          {confirming} confirming
        </Badge>
      )}
      {forming > 0 && (
        <Badge variant="outline" className="text-[10px] text-sky-300 border-sky-500/40 bg-sky-500/10" data-testid="badge-msa-forming">
          {forming} developing
        </Badge>
      )}
      {rejected > 0 && (
        <Badge variant="outline" className="text-[10px] text-amber-300 border-amber-500/40" data-testid="badge-msa-rejected">
          {rejected} did not qualify
        </Badge>
      )}
      {unavailable > 0 && (
        <Badge variant="outline" className="text-[10px] text-muted-foreground" data-testid="badge-msa-unavailable">
          {unavailable} no signal
        </Badge>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Supporting strategy row
// ---------------------------------------------------------------------------

function SupportingRow({ entry }: { entry: MsaSetupEntry }) {
  const s = entry.setup;
  const checkLabel = msaCandidateCheckLabel(entry);
  const reason = entry.candidateCheck?.reason ?? (s.reasons ?? [])[0] ?? null;
  const intraday = msaIsIntraday(s);
  const statusBadge = msaStatusBadge(s.status);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs" data-testid={`row-msa-supporting-${s.strategy}`}>
      <span className="font-medium">{msaStrategyName(s)}</span>
      <span className={statusBadge.className || "text-muted-foreground"}>— {statusBadge.label}</span>
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

// ---------------------------------------------------------------------------
// No-qualifying-setup empty state
// ---------------------------------------------------------------------------

function NoSetupEmptyState({ a }: { a: MultiStrategyAnalysis }) {
  const noMatch = a.noMatchStrategies ?? [];
  const hasContext = noMatch.length > 0 || (a.marketContext?.earningsRisk && a.marketContext.earningsRisk !== "NONE");
  return (
    <div
      className="rounded-md border border-muted/50 bg-muted/10 p-3 space-y-2 text-xs text-muted-foreground"
      data-testid="section-msa-no-setup"
    >
      <div className="font-medium text-foreground/80">No qualifying setup was identified.</div>
      <p>
        The deterministic analysis did not find the conditions required for a qualified technical setup
        for {a.symbol} at this time.
      </p>
      {hasContext && (
        <div className="space-y-1 pt-1">
          {noMatch.length > 0 && (
            <div>
              <span className="font-medium text-foreground/70">Strategies with no current setup:</span>{" "}
              {noMatch.join(", ")}
            </div>
          )}
          {a.marketContext?.earningsRisk && a.marketContext.earningsRisk !== "NONE" && (
            <div>
              <span className="font-medium text-foreground/70">Context:</span>{" "}
              Earnings risk is present ({a.marketContext.earningsRisk.toLowerCase()}), which may affect setup eligibility.
            </div>
          )}
        </div>
      )}
      <p className="text-[10px]">
        A qualified setup requires specific breakout structure, volume confirmation, and risk levels to be simultaneously present. When any of these conditions are absent, the setup does not qualify.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main card
// ---------------------------------------------------------------------------

export function MultiStrategyAnalysisCards({ analysis }: { analysis: MultiStrategyAnalysis | null | undefined }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  if (!isRenderableMultiStrategyAnalysis(analysis)) return null;
  const a = analysis;
  const p = a.primarySetup ?? null;
  const ps = p?.setup;
  const noMatch = a.noMatchStrategies ?? [];
  const failed = a.failedStrategies ?? [];
  const hasAdvanced = noMatch.length > 0 || failed.length > 0;
  // Genuine price-scale failure: suppress levels and show warning banner.
  // STALE / UNAVAILABLE codes mean "unverified", not "wrong" — do not suppress.
  const integrityCode = a.priceIntegrity?.code;
  const integrityFailed =
    a.priceIntegrity?.valid === false &&
    integrityCode !== "PRICE_REFERENCE_STALE" &&
    integrityCode !== "PRICE_REFERENCE_UNAVAILABLE";

  // Deduplication: if trigger price equals objective price, show only once.
  const triggerPrice = ps?.trigger?.price ?? null;
  const objectivePrice = ps?.technicalObjective?.price ?? null;
  const showObjectiveSeparately =
    msaFmtPrice(objectivePrice) !== null && objectivePrice !== triggerPrice;

  const primaryStatusBadge = msaStatusBadge(ps?.status);

  return (
    <div className="space-y-3" data-testid="cards-multi-strategy-analysis">
      {integrityFailed && <IntegrityWarning symbol={a.symbol} />}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            {a.symbol} — Multi-Strategy Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Verdict + freshness */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={`text-[10px] ${VERDICT_TONE[a.overallVerdict] ?? ""}`} data-testid="badge-msa-verdict">
              {MSA_VERDICT_LABELS[a.overallVerdict] ?? a.overallVerdict}
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

          {/* Count breakdown (spec §5 — replaces misleading "X matches" badge) */}
          <CountBreakdown a={a} />

          {/* Primary setup */}
          {p && ps ? (
            <div className="rounded-lg border p-3 space-y-3" data-testid="card-msa-primary">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{msaStrategyName(ps)}</span>
                <Badge variant="outline" className={`text-[10px] ${primaryStatusBadge.className}`}>
                  {primaryStatusBadge.label}
                </Badge>
                {ps.direction && <Badge variant="outline" className="text-[10px] capitalize">{ps.direction}</Badge>}
                {typeof ps.score === "number" && (
                  <Badge variant="outline" className="text-[10px]">Score {Math.round(ps.score)}</Badge>
                )}
              </div>

              {/* Price-derived levels — suppressed when integrity failed */}
              {integrityFailed ? (
                <div
                  className="rounded-sm bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground"
                  data-testid="section-msa-price-suppressed"
                >
                  Price-level analysis unavailable
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5 text-xs" data-testid="section-msa-price-levels">
                  {msaFmtPrice(triggerPrice) && (
                    <div>
                      <span className="text-muted-foreground">Entry confirmation:</span>{" "}
                      <span className="tabular-nums">{msaFmtPrice(triggerPrice)}</span>
                    </div>
                  )}
                  {msaFmtPrice(ps.invalidation?.price) && (
                    <div>
                      <span className="text-muted-foreground">Risk reference:</span>{" "}
                      <span className="tabular-nums">{msaFmtPrice(ps.invalidation?.price)}</span>
                    </div>
                  )}
                  {showObjectiveSeparately && (
                    <div>
                      <span className="text-muted-foreground">Research objective:</span>{" "}
                      <span className="tabular-nums">{msaFmtPrice(objectivePrice)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Research outcome (candidate check) */}
              {msaCandidateCheckLabel(p) && (
                <div className="text-xs" data-testid="text-msa-candidate-verdict">
                  <span className="text-muted-foreground">Research outcome:</span>{" "}
                  <span className={CANDIDATE_TONE[p.candidateCheck?.status ?? "UNAVAILABLE"] ?? ""}>
                    {msaCandidateCheckLabel(p)}
                  </span>
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

              {/* Why it's not actionable */}
              {(a.overallVerdict === "WATCH" || a.overallVerdict === "NO_TRADE") &&
                (p.candidateCheck?.reason || (p.candidateCheck?.warnings ?? []).length > 0) && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-1.5" data-testid="section-msa-not-actionable">
                    <div className="text-xs font-medium text-amber-300">Why it's not actionable</div>
                    <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1">
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
          ) : (
            /* Empty state — no qualifying setup */
            (a.overallVerdict === "NO_TRADE" || a.overallVerdict === "INSUFFICIENT_DATA") && (
              <NoSetupEmptyState a={a} />
            )
          )}

          {/* Supporting setups */}
          {a.supportingSetups.length > 0 && (
            <div className="space-y-2.5" data-testid="list-msa-supporting">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Key evidence</div>
              {SUPPORT_GROUP_ORDER.map((group) => {
                const items = a.supportingSetups.filter((e) => msaSupportGroup(e) === group);
                if (items.length === 0) return null;
                return (
                  <div key={group} className="space-y-1.5" data-testid={`group-msa-supporting-${group}`}>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
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

          {/* Advanced section */}
          {hasAdvanced && (
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                data-testid="button-msa-advanced-toggle"
              >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
                Strategies with no active setup{failed.length > 0 ? " or data" : ""}
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2 space-y-1.5 text-xs text-muted-foreground" data-testid="section-msa-advanced">
                {noMatch.length > 0 && (
                  <div>No active setup detected: {noMatch.join(", ")}</div>
                )}
                {failed.length > 0 && (
                  <div>Analysis not available: {failed.map((f) => f.strategy).join(", ")}</div>
                )}
              </CollapsibleContent>
            </Collapsible>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
