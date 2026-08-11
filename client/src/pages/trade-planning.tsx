/**
 * Trade Planning Page — /trade-planning/:symbol
 *
 * Sprint 2.7.0: Research → Trade Planning bridge.
 *
 * Shows how a qualified research candidate could potentially be expressed.
 * Does NOT show: order tickets, contract selectors, strikes, expirations,
 * recommendations, "best trade" language, or suitability assessments.
 *
 * COMPLIANCE:
 *   "Trade Planning provides research scenarios showing how an existing research
 *   thesis could potentially be expressed. It does not constitute investment
 *   advice, a personalized recommendation, a suitability determination, or an
 *   instruction to buy, sell, hold, or enter any security or strategy."
 */

import { useState, useEffect, useMemo } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertCircle, AlertTriangle, ArrowLeft, ArrowRight, BarChart2, BookOpen,
  Check, ChevronDown, ChevronRight, Clock, ExternalLink, HelpCircle,
  Info, Loader2, Lock, RefreshCw, Shield, Target, TrendingUp, XCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type {
  TradePlanningContext, TradePlanningConstraints, ExpressionFamilyResult,
  ExpressionStatus, TradePlanningSession, ExpressionFamily,
} from "@shared/trade-planning-types";
import {
  TRADE_PLANNING_DISCLAIMER, CONSTRAINTS_DISCLAIMER, NO_RANKING_DISCLAIMER,
  DEFAULT_CONSTRAINTS, validateConstraints, EXPRESSION_STATUS_LABELS,
  EXPRESSION_STATUS_DESCRIPTIONS, validateExpressionFamily,
} from "@shared/trade-planning-types";
import type { EquityPlanningScenario } from "@shared/equity-planning-types";
import { EquityOrderPreviewPanel } from "@/components/execution/EquityOrderPreviewPanel";
import { OptionsOrderPreviewPanel } from "@/components/execution/OptionsOrderPreviewPanel";
import {
  EQUITY_PLANNING_DISCLAIMER, SIZING_DISCLAIMER, SCENARIO_DISCLAIMER,
} from "@shared/equity-planning-types";
import type {
  OptionsStrategyMatchResult, OptionsStrategyMatch, StrategyMatchStatus,
} from "@shared/options-strategy-types";
import {
  OPTIONS_STRATEGY_DISCLAIMER, OPTIONS_RISK_DISCLOSURE, NO_RECOMMENDATION_NOTE,
  STRATEGY_MATCH_STATUS_LABELS,
} from "@shared/options-strategy-types";
import type {
  OptionsContractResearchResult, OptionsStructureResearchCandidate,
  ContractResearchFilters,
} from "@shared/contract-research-types";
import {
  CONTRACT_RESEARCH_DISCLAIMER, MIDPOINT_DISCLAIMER, OPTIONS_RISK_DISCLOSURE_EXTENDED,
  DEFAULT_CONTRACT_RESEARCH_FILTERS,
} from "@shared/contract-research-types";
import type {
  TradeRiskScenarioResult, RiskFlag, ConstraintCheck,
} from "@shared/trade-risk-scenario-types";
import {
  RISK_SCENARIO_DISCLAIMER, MIDPOINT_EXECUTION_NOTE,
} from "@shared/trade-risk-scenario-types";

// ---------------------------------------------------------------------------
// Reserved route segments (defense-in-depth)
// ---------------------------------------------------------------------------
const RESERVED_SEGMENTS = new Set(["health", "session", "history", "templates", "metadata"]);

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function ExpressionStatusBadge({ status }: { status: ExpressionStatus }) {
  const styles: Record<ExpressionStatus, string> = {
    applicable:             "bg-green-500/20 text-green-400 border-green-500/30",
    potentially_applicable: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    unavailable:            "bg-muted text-muted-foreground",
  };
  const label = EXPRESSION_STATUS_LABELS[status];
  return (
    <Badge className={`text-xs ${styles[status]}`} aria-label={`Status: ${label}`}>
      {status === "applicable"             && <Check className="h-3 w-3 mr-1" aria-hidden="true" />}
      {status === "potentially_applicable" && <Clock className="h-3 w-3 mr-1" aria-hidden="true" />}
      {status === "unavailable"            && <XCircle className="h-3 w-3 mr-1" aria-hidden="true" />}
      {label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Freshness indicator
// ---------------------------------------------------------------------------

function FreshnessTag({ status, label }: { status: string; label: string }) {
  if (status === "fresh")       return <span className="text-xs text-green-400">{label}</span>;
  if (status === "aging")       return <span className="text-xs text-yellow-400">{label}</span>;
  if (status === "stale")       return <span className="text-xs text-red-400">{label} — may be stale</span>;
  return <span className="text-xs text-muted-foreground">Not available</span>;
}

// ---------------------------------------------------------------------------
// Expression family card
// ---------------------------------------------------------------------------

function ExpressionCard({
  result,
  selected,
  onSelect,
}: {
  result:   ExpressionFamilyResult;
  selected: boolean;
  onSelect: (f: ExpressionFamily) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isUnavailable = result.status === "unavailable";

  return (
    <Card
      className={`border transition-colors cursor-pointer ${
        selected
          ? "border-primary/70 bg-primary/5"
          : isUnavailable
            ? "border-border/30 opacity-60"
            : "border-border/50 hover:border-border"
      }`}
      onClick={() => !isUnavailable && onSelect(result.family)}
      role="radio"
      aria-checked={selected}
      aria-disabled={isUnavailable}
      tabIndex={isUnavailable ? -1 : 0}
      onKeyDown={e => { if (!isUnavailable && (e.key === " " || e.key === "Enter")) onSelect(result.family); }}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold">{result.label}</span>
              {selected && <Check className="h-3.5 w-3.5 text-primary" aria-label="Selected" />}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{result.description}</p>
          </div>
          <ExpressionStatusBadge status={result.status} />
        </div>

        {/* Reasons */}
        {result.reasons.length > 0 && (
          <div className="space-y-1">
            {result.reasons.slice(0, expanded ? undefined : 2).map((r, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Check className="h-3 w-3 text-green-400 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{r}</span>
              </div>
            ))}
          </div>
        )}

        {/* Missing constraints */}
        {result.constraintsMissing.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-yellow-400">Missing Constraints:</p>
            {result.constraintsMissing.map((m, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <AlertTriangle className="h-3 w-3 text-yellow-400 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{m}</span>
              </div>
            ))}
          </div>
        )}

        {/* Limitations */}
        {result.limitations.length > 0 && (
          <div className="space-y-1">
            {result.limitations.map((l, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="h-3 w-3 text-blue-400 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{l}</span>
              </div>
            ))}
          </div>
        )}

        {/* Expand/collapse for long reason lists */}
        {result.reasons.length > 2 && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setExpanded(x => !x); }}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {expanded ? "Show less" : `Show ${result.reasons.length - 2} more reasons`}
          </button>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Equity Planning Panel (Sprint 2.7.1) — shown when equity family selected
// ---------------------------------------------------------------------------

function ScenarioRow({ pct, price, pl, plPct, refLabel }: {
  pct: number; price: number; pl: number | null; plPct: number | null;
  refLabel: string | null;
}) {
  const isNeutral = pct === 0;
  const isNeg     = pct < 0;
  return (
    <tr className={`border-b border-border/20 ${refLabel ? "bg-primary/5" : ""}`}>
      <td className="py-1.5 px-2 text-xs font-medium tabular-nums">
        <span className={isNeg ? "text-red-400" : isNeutral ? "text-muted-foreground" : "text-green-400"}>
          {pct > 0 ? "+" : ""}{(pct * 100).toFixed(0)}%
        </span>
      </td>
      <td className="py-1.5 px-2 text-xs tabular-nums text-right">${price.toFixed(2)}</td>
      <td className="py-1.5 px-2 text-xs tabular-nums text-right">
        {pl !== null ? (
          <span className={pl < 0 ? "text-red-400" : pl > 0 ? "text-green-400" : "text-muted-foreground"}>
            {pl >= 0 ? "+" : ""}${pl.toFixed(2)}
          </span>
        ) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="py-1.5 px-2 text-xs tabular-nums text-right">
        {pl !== null && plPct !== null ? (
          <span className={plPct < 0 ? "text-red-400" : plPct > 0 ? "text-green-400" : "text-muted-foreground"}>
            {plPct >= 0 ? "+" : ""}{plPct.toFixed(0)}%
          </span>
        ) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="py-1.5 px-2 text-xs text-muted-foreground">
        {refLabel && <span className="text-xs text-primary/70">{refLabel}</span>}
      </td>
    </tr>
  );
}

function EquityPlanningPanel({
  symbol, sessionId, constraints,
}: {
  symbol: string; sessionId: string; constraints: TradePlanningConstraints;
}) {
  const [downsidePct, setDownsidePct] = useState(-0.20);
  const [upsidePct,   setUpsidePct]   = useState(0.20);
  const [showFull, setShowFull]        = useState(false);

  const equityQuery = useQuery<{ scenario: EquityPlanningScenario; disclaimer: string }>({
    queryKey: [`/api/trade-planning/session/${sessionId}/equity`, constraints],
    queryFn: () => apiRequest("GET", `/api/trade-planning/session/${sessionId}/equity`).then(r => r.json()),
    enabled: !!sessionId,
  });

  const scenarioQuery = useQuery<{
    scenarioGrid: EquityPlanningScenario["scenarioGrid"];
    referencePrice: number | null;
    disclaimer: string;
  }>({
    queryKey: [`/api/trade-planning/session/${sessionId}/equity/scenarios`, downsidePct, upsidePct],
    queryFn: () => apiRequest("GET", `/api/trade-planning/session/${sessionId}/equity/scenarios?downsidePct=${downsidePct}&upsidePct=${upsidePct}`).then(r => r.json()),
    enabled: !!sessionId,
  });

  const scenario = equityQuery.data?.scenario;

  if (equityQuery.isLoading) {
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Building equity research scenario…
        </CardContent>
      </Card>
    );
  }

  if (equityQuery.isError || !scenario) {
    return (
      <Card className="border-border/50">
        <CardContent className="p-4 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 inline mr-1 text-yellow-400" />
          Equity scenario unavailable — reference price or research data may be missing.
        </CardContent>
      </Card>
    );
  }

  const grid   = scenarioQuery.data?.scenarioGrid ?? scenario.scenarioGrid;
  const sizing = scenario.sizingFramework;

  return (
    <div className="space-y-4" aria-label="Equity Research Scenario">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" aria-hidden="true" />
          Equity Research Scenario
        </h2>
        {scenario.freshness?.hasStaleCriticalData && (
          <Badge variant="outline" className="text-xs text-yellow-400 border-yellow-400/30">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Stale Data
          </Badge>
        )}
      </div>

      {/* Stale warning */}
      {scenario.freshness?.hasStaleCriticalData && scenario.freshness.staleWarning && (
        <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-xs text-yellow-300 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          {scenario.freshness.staleWarning}
        </div>
      )}

      {/* Limitations */}
      {scenario.limitations.length > 0 && (
        <div className="space-y-1">
          {scenario.limitations.map((l, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="h-3 w-3 shrink-0 mt-0.5 text-blue-400" />
              {l}
            </div>
          ))}
        </div>
      )}

      {/* Reference price + freshness */}
      {scenario.referencePrice && (
        <Card className="border-border/50">
          <CardContent className="p-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Reference Price</p>
              <p className="text-xl font-bold tabular-nums">${scenario.referencePrice.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{scenario.referencePriceSource}</p>
            </div>
            <div className="text-right">
              <FreshnessTag
                status={scenario.freshness?.referencePrice?.status ?? "unavailable"}
                label={scenario.freshness?.referencePrice?.ageLabel ?? "Unknown"}
              />
              <p className="text-xs text-muted-foreground mt-0.5">Stored daily bars</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Entry Framework */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Research Entry Framework</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!scenario.entryFramework.available ? (
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-400" />
              {scenario.entryFramework.unavailableReason ?? "Entry framework unavailable."}
            </div>
          ) : (
            <>
              {scenario.entryFramework.conditionType && (
                <Badge variant="outline" className="text-xs">
                  {scenario.entryFramework.conditionType.replace(/_/g, " ")}
                </Badge>
              )}

              {/* Reference levels */}
              {scenario.entryFramework.referenceLevels.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Reference Levels</p>
                  {scenario.entryFramework.referenceLevels.map((rl, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span>{rl.label}</span>
                      <span className="tabular-nums font-medium">${rl.price.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Entry zones */}
              {scenario.entryFramework.entryZones.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Research Entry Zone</p>
                  {scenario.entryFramework.entryZones.map((z, i) => (
                    <div key={i} className="p-2 rounded-lg bg-muted/30 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{z.label}</span>
                        <span className="tabular-nums font-medium">
                          ${z.priceLow.toFixed(2)} – ${z.priceHigh.toFixed(2)}
                        </span>
                      </div>
                      <div className="text-muted-foreground mt-0.5">{z.reason}</div>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground italic">
                    Research zones are not buy instructions.
                  </p>
                </div>
              )}

              {/* Required evidence */}
              {scenario.entryFramework.requiredEvidence.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Required Evidence</p>
                  {scenario.entryFramework.requiredEvidence.slice(0, 3).map((e, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Check className="h-3 w-3 text-green-400 shrink-0 mt-0.5" />
                      {e}
                    </div>
                  ))}
                </div>
              )}

              {/* Notes */}
              {scenario.entryFramework.notes.map((n, i) => (
                <p key={i} className="text-xs text-muted-foreground italic">{n}</p>
              ))}
            </>
          )}
        </CardContent>
      </Card>

      {/* Hypothetical Position Sizing */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Hypothetical Position Sizing</CardTitle>
          <CardDescription className="text-xs">{SIZING_DISCLAIMER}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(!sizing.capitalAvailable && !sizing.maxCapitalAtRisk) ? (
            <p className="text-xs text-muted-foreground">
              Enter planning constraints above to see hypothetical sizing.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { label: "Reference Price", value: sizing.referencePrice ? `$${sizing.referencePrice.toFixed(2)}` : "—" },
                { label: "Risk per Share", value: sizing.riskPerShare ? `$${sizing.riskPerShare.toFixed(2)}` : "—" },
                { label: "Shares by Capital", value: sizing.sharesByCapitalLimit?.toString() ?? "—" },
                { label: "Shares by Risk Limit", value: sizing.sharesByRiskLimit?.toString() ?? "—" },
                { label: "Hypothetical Shares", value: sizing.effectiveScenarioShares !== null ? `${sizing.effectiveScenarioShares} shares` : "—" },
                { label: "Capital Required", value: sizing.capitalRequired ? `$${sizing.capitalRequired.toLocaleString()}` : "—" },
                { label: "Est. Loss at Invalidation", value: sizing.estimatedLossAtInvalidation ? `$${sizing.estimatedLossAtInvalidation.toLocaleString()}` : "—" },
                { label: "Capital Utilization", value: sizing.capitalPercentOfPlanningCapital ? `${sizing.capitalPercentOfPlanningCapital}%` : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="p-2 rounded-lg bg-muted/30 text-center">
                  <div className="text-xs font-medium tabular-nums">{value}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          )}

          {sizing.partialReasons.length > 0 && (
            <div className="space-y-1">
              {sizing.partialReasons.map((r, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="h-3 w-3 shrink-0 mt-0.5 text-blue-400" />
                  {r}
                </div>
              ))}
            </div>
          )}

          {sizing.roundingNotes.length > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Rounding notes</summary>
              <div className="mt-1 space-y-0.5 pl-2">
                {sizing.roundingNotes.map((n, i) => <div key={i}>{n}</div>)}
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      {/* Scenario Analysis */}
      {grid && grid.scenarioPoints.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm">Hypothetical Scenario Analysis</CardTitle>
              <p className="text-xs text-muted-foreground">Not a price forecast</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Reward/Risk */}
            {grid.rewardRiskRatio !== null && (
              <div className="flex items-center gap-3 text-xs flex-wrap">
                <div className="px-2 py-1 rounded bg-muted/30">
                  <span className="text-muted-foreground">Scenario R/R:</span>{" "}
                  <span className="font-medium">{grid.rewardRiskRatio.toFixed(2)}:1</span>
                </div>
                {grid.upsideDistance !== null && (
                  <div className="px-2 py-1 rounded bg-muted/30">
                    <span className="text-muted-foreground">Upside Ref:</span>{" "}
                    <span className="font-medium text-green-400">+${grid.upsideDistance.toFixed(2)}</span>
                  </div>
                )}
                {grid.downsideDistance !== null && (
                  <div className="px-2 py-1 rounded bg-muted/30">
                    <span className="text-muted-foreground">Invalidation Ref:</span>{" "}
                    <span className="font-medium text-red-400">-${grid.downsideDistance.toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}

            {/* Scenario range controls */}
            <div className="flex items-center gap-3 flex-wrap text-xs">
              <div className="flex items-center gap-1.5">
                <label htmlFor="downside-pct" className="text-muted-foreground">Downside</label>
                <Select value={String(downsidePct)} onValueChange={v => setDownsidePct(parseFloat(v))}>
                  <SelectTrigger id="downside-pct" className="h-7 w-24 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[-0.50, -0.30, -0.20, -0.10, -0.05].map(v => (
                      <SelectItem key={v} value={String(v)}>{(v*100).toFixed(0)}%</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1.5">
                <label htmlFor="upside-pct" className="text-muted-foreground">Upside</label>
                <Select value={String(upsidePct)} onValueChange={v => setUpsidePct(parseFloat(v))}>
                  <SelectTrigger id="upside-pct" className="h-7 w-24 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[0.05, 0.10, 0.20, 0.30, 0.50, 1.00].map(v => (
                      <SelectItem key={v} value={String(v)}>+{(v*100).toFixed(0)}%</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Scenario grid table */}
            <div className="overflow-x-auto rounded-lg border border-border/30">
              <table className="w-full text-xs" aria-label="Hypothetical scenario analysis grid">
                <thead>
                  <tr className="border-b border-border/30 bg-muted/20">
                    <th className="py-1.5 px-2 text-left font-medium text-muted-foreground">Move</th>
                    <th className="py-1.5 px-2 text-right font-medium text-muted-foreground">Hyp. Price</th>
                    <th className="py-1.5 px-2 text-right font-medium text-muted-foreground">Scenario P/L</th>
                    <th className="py-1.5 px-2 text-right font-medium text-muted-foreground">P/L %</th>
                    <th className="py-1.5 px-2 text-left font-medium text-muted-foreground">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {grid.scenarioPoints.map((pt, i) => (
                    <ScenarioRow
                      key={i}
                      pct={pt.percentChange}
                      price={pt.hypotheticalPrice}
                      pl={pt.hypotheticalPL}
                      plPct={pt.hypotheticalPLPct}
                      refLabel={pt.referenceLevelLabel}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted-foreground text-center italic">{grid.disclaimer}</p>
          </CardContent>
        </Card>
      )}

      {/* Monitoring Plan */}
      {scenario.monitoringPlan.items.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Research Monitoring Plan</CardTitle>
              <button
                type="button"
                onClick={() => setShowFull(x => !x)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {showFull ? "Show less" : "Show all"}
              </button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {(showFull ? scenario.monitoringPlan.items : scenario.monitoringPlan.items.slice(0, 4)).map((item, i) => (
              <div key={i} className="p-2.5 rounded-lg bg-muted/30 space-y-0.5">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs capitalize px-1.5">
                    {item.category.replace(/_/g, " ")}
                  </Badge>
                  <span className="text-xs font-medium">{item.label}</span>
                </div>
                <p className="text-xs text-muted-foreground">Current: {item.currentState}</p>
                <p className="text-xs text-muted-foreground italic">{item.watchCondition}</p>
              </div>
            ))}
            <p className="text-xs text-muted-foreground text-center">{scenario.monitoringPlan.alertsNote}</p>
          </CardContent>
        </Card>
      )}

      {/* Equity compliance */}
      <div className="p-3 rounded-lg bg-muted/30 border border-border/40 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 inline mr-1" />
        {EQUITY_PLANNING_DISCLAIMER}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Options Strategy Panel — Sprint 2.7.2
// ---------------------------------------------------------------------------

const OPTIONS_STRATEGY_FAMILY_GROUPS: Record<string, string> = {
  long_call:         "Directional Bullish",
  long_put:          "Directional Bearish",
  bull_call_spread:  "Directional Bullish",
  bear_put_spread:   "Directional Bearish",
  bull_put_spread:   "Directional Bullish",
  bear_call_spread:  "Directional Bearish",
  covered_call:      "Income",
  cash_secured_put:  "Income",
  iron_condor:       "Neutral / Range-Bound",
  iron_butterfly:    "Neutral / Range-Bound",
  calendar_spread:   "Neutral / Range-Bound",
  long_straddle:     "Volatility",
  long_strangle:     "Volatility",
  protective_put:    "Protective",
  collar:            "Protective",
  diagonal_spread:   "Directional Bullish",
  monitor_only:      "Monitor Only",
};

const STATUS_COLORS: Record<StrategyMatchStatus, string> = {
  APPLICABLE:            "border-green-500/40 bg-green-500/5",
  POTENTIALLY_APPLICABLE:"border-yellow-500/40 bg-yellow-500/5",
  NOT_APPLICABLE:        "border-border/30 bg-muted/20",
  UNAVAILABLE:           "border-border/20 bg-muted/10 opacity-60",
};

const STATUS_BADGE_COLORS: Record<StrategyMatchStatus, string> = {
  APPLICABLE:            "bg-green-500/20 text-green-400 border-green-500/30",
  POTENTIALLY_APPLICABLE:"bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  NOT_APPLICABLE:        "bg-muted/40 text-muted-foreground",
  UNAVAILABLE:           "bg-muted/20 text-muted-foreground",
};

function StrategyFamilyCard({ match }: { match: OptionsStrategyMatch }) {
  const [open, setOpen] = useState(false);
  const statusColor     = STATUS_COLORS[match.status];
  const badgeColor      = STATUS_BADGE_COLORS[match.status];
  const groupLabel      = OPTIONS_STRATEGY_FAMILY_GROUPS[match.strategyFamily] ?? match.strategyCategoryLabel;
  const isApplicable    = match.status === "APPLICABLE" || match.status === "POTENTIALLY_APPLICABLE";

  return (
    <div className={`rounded-lg border p-3 transition-colors ${statusColor}`}>
      <button
        type="button"
        className="w-full flex items-start justify-between gap-2 text-left"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={`sfam-${match.strategyFamily}`}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{match.strategyLabel}</span>
            <span className="text-xs text-muted-foreground">{groupLabel}</span>
          </div>
          {/* Quick tags */}
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {match.structure.isDefinedRisk && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                Defined Risk
              </span>
            )}
            {match.structure.isIncomeFocused && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                Income
              </span>
            )}
            {match.structure.requiresOwnership && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                Requires Shares
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded border font-medium ${badgeColor}`}>
            {STRATEGY_MATCH_STATUS_LABELS[match.status]}
          </span>
          {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
      </button>

      {open && (
        <div id={`sfam-${match.strategyFamily}`} className="mt-3 space-y-3 text-xs">
          {/* Structure overview */}
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center p-2 rounded bg-muted/30">
              <div className="text-muted-foreground mb-0.5">Legs</div>
              <div className="font-medium">{match.structure.legCount}</div>
            </div>
            <div className="text-center p-2 rounded bg-muted/30">
              <div className="text-muted-foreground mb-0.5">Premium</div>
              <div className="font-medium capitalize">{match.structure.premiumDirection}</div>
            </div>
            <div className="text-center p-2 rounded bg-muted/30">
              <div className="text-muted-foreground mb-0.5">Directional</div>
              <div className="font-medium">{match.structure.isDirectional ? "Yes" : "No"}</div>
            </div>
          </div>

          {/* Reasons */}
          {match.reasons.length > 0 && (
            <div>
              <p className="font-medium text-foreground mb-1">Why {STRATEGY_MATCH_STATUS_LABELS[match.status]}</p>
              <ul className="space-y-0.5">
                {match.reasons.map((r, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-muted-foreground">
                    <span className="text-muted-foreground shrink-0 mt-0.5">•</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Risk characteristics */}
          {match.riskCharacteristics.length > 0 && (
            <div>
              <p className="font-medium text-foreground mb-1">Broad Risk Characteristics</p>
              <ul className="space-y-0.5">
                {match.riskCharacteristics.map((r, i) => (
                  <li key={i} className="text-muted-foreground flex items-start gap-1.5">
                    <span className="shrink-0 mt-0.5">•</span><span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Constraints satisfied */}
          {match.constraintsSatisfied.length > 0 && (
            <div>
              <p className="font-medium text-foreground mb-1">Planning Preferences Satisfied</p>
              <ul className="space-y-0.5">
                {match.constraintsSatisfied.map((c, i) => (
                  <li key={i} className="text-green-400 flex items-start gap-1.5">
                    <Check className="h-3 w-3 shrink-0 mt-0.5" /><span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Portfolio requirements */}
          {match.portfolioRequirements.length > 0 && (
            <div>
              <p className="font-medium text-foreground mb-1">Portfolio Requirements</p>
              <ul className="space-y-0.5">
                {match.portfolioRequirements.map((r, i) => (
                  <li key={i} className="text-purple-400 flex items-start gap-1.5">
                    <Shield className="h-3 w-3 shrink-0 mt-0.5" /><span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Event considerations */}
          {match.eventConsiderations.length > 0 && (
            <div>
              <p className="font-medium text-foreground mb-1">Event Considerations</p>
              <ul className="space-y-0.5">
                {match.eventConsiderations.map((e, i) => (
                  <li key={i} className="text-yellow-400 flex items-start gap-1.5">
                    <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" /><span>{e}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Limitations */}
          {match.limitations.length > 0 && (
            <div>
              <p className="font-medium text-foreground mb-1">Data Limitations</p>
              <ul className="space-y-0.5">
                {match.limitations.map((l, i) => (
                  <li key={i} className="text-muted-foreground flex items-start gap-1.5">
                    <Info className="h-3 w-3 shrink-0 mt-0.5" /><span>{l}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Next-stage requirements (only for applicable) */}
          {isApplicable && match.nextStageRequirements.length > 0 && (
            <div className="pt-2 border-t border-border/30">
              <p className="font-medium text-foreground mb-1 flex items-center gap-1.5">
                <ArrowRight className="h-3 w-3 text-primary" />
                Contract Research Requirements (2.7.3)
              </p>
              <ul className="space-y-0.5">
                {match.nextStageRequirements.map((n, i) => (
                  <li key={i} className="text-muted-foreground flex items-start gap-1.5">
                    <span className="shrink-0 mt-0.5">•</span><span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Risk Analysis Panel — Sprint 2.7.4
// ===========================================================================

const CONSTRAINT_STATUS_LABELS: Record<string, string> = {
  WITHIN_CONSTRAINT:  "Within Constraint",
  EXCEEDS_CONSTRAINT: "Exceeds Constraint",
  NO_CONSTRAINT_SET:  "No Constraint Set",
  UNDEFINED_RISK:     "Undefined Risk",
};

const CRITICAL_FLAG_CODES = new Set(["MAX_LOSS_EXCEEDS_CONSTRAINT", "UNLIMITED_GAIN", "SUBSTANTIAL_UNDERLYING_DOWNSIDE"]);
const WARNING_FLAG_CODES  = new Set(["EVENT_WINDOW", "STALE_QUOTE", "WIDE_BID_ASK", "ASSIGNMENT_RISK", "EARLY_EXERCISE_RISK"]);

function ConstraintBadge({ check }: { check: ConstraintCheck }) {
  const colors: Record<string, string> = {
    WITHIN_CONSTRAINT:  "text-emerald-400 border-emerald-400/30",
    EXCEEDS_CONSTRAINT: "text-red-400     border-red-400/30",
    NO_CONSTRAINT_SET:  "text-muted-foreground border-border/50",
    UNDEFINED_RISK:     "text-yellow-400  border-yellow-400/30",
  };
  return (
    <Badge variant="outline" className={`text-xs ${colors[check.status] ?? "text-muted-foreground"}`}>
      {CONSTRAINT_STATUS_LABELS[check.status] ?? check.status}
    </Badge>
  );
}

function RiskFlagItem({ flag }: { flag: RiskFlag }) {
  const isCritical = CRITICAL_FLAG_CODES.has(flag.code);
  const isWarning  = WARNING_FLAG_CODES.has(flag.code);
  const cls = isCritical ? "text-red-400" : isWarning ? "text-yellow-400" : "text-muted-foreground";
  return (
    <div className={`flex items-start gap-1.5 text-xs ${cls}`}>
      <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
      <span>{flag.note}</span>
    </div>
  );
}

function RiskAnalysisPanel({
  sessionId,
  candidateId,
  onBack,
}: {
  sessionId: string;
  candidateId: string;
  onBack: () => void;
}) {
  const riskMutation = useMutation<{ result: TradeRiskScenarioResult }, Error, void>({
    mutationFn: () =>
      apiRequest("POST", `/api/trade-planning/session/${sessionId}/risk-analysis`, {
        contractResearchCandidateId: candidateId,
      }).then(r => r.json()),
  });

  useEffect(() => {
    riskMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId]);

  const result = riskMutation.data?.result;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={onBack}>
          <ArrowLeft className="h-3 w-3 mr-1" /> Back to Contract Research
        </Button>
        <span className="text-xs text-muted-foreground">Risk &amp; Scenario Analysis</span>
      </div>

      {/* Loading */}
      {riskMutation.isPending && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground p-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          Building risk scenario analysis…
        </div>
      )}

      {/* Error */}
      {riskMutation.isError && (
        <Card className="border-red-400/30">
          <CardContent className="p-3 text-xs text-red-400 flex items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {riskMutation.error?.message ?? "Failed to build risk analysis."}
          </CardContent>
        </Card>
      )}

      {result && (
        <>
          {/* Structure Summary */}
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-sm">{result.structureSummary.strategyLabel}</CardTitle>
                <ConstraintBadge check={result.constraintCheck} />
              </div>
              {result.structureSummary.expirations.length > 0 && (
                <CardDescription className="text-xs">Expiration: {result.structureSummary.expirations.join(" / ")}</CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              {result.structureSummary.legs.map((l, i) => (
                <div key={i} className="flex items-center justify-between bg-muted/20 rounded px-2 py-1.5">
                  <span>{l.roleLabel} {l.optionType.toUpperCase()} ${l.strike}</span>
                  {l.midpoint !== null && <span className="text-muted-foreground">Mid ${l.midpoint.toFixed(2)}</span>}
                </div>
              ))}
              {result.structureSummary.liquidityCategoryLabel && (
                <p className="text-muted-foreground">Liquidity: {result.structureSummary.liquidityCategoryLabel}</p>
              )}
            </CardContent>
          </Card>

          {/* Payoff Profile */}
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Payoff Profile (at Expiration)</CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-muted/20 rounded px-2 py-1.5">
                  <p className="text-muted-foreground text-[10px] uppercase tracking-wide mb-0.5">Max Loss</p>
                  <p className="font-medium">
                    {result.payoffProfile.maxLoss.type === "DEFINED"
                      ? (result.payoffProfile.maxLoss.perContractDollars !== null ? `$${result.payoffProfile.maxLoss.perContractDollars.toLocaleString()}` : "Defined")
                      : result.payoffProfile.maxLoss.type === "SUBSTANTIAL"
                      ? "Substantial"
                      : result.payoffProfile.maxLoss.type === "UNLIMITED"
                      ? "Unlimited"
                      : result.payoffProfile.maxLoss.type}
                  </p>
                  {result.payoffProfile.maxLoss.note && (
                    <p className="text-muted-foreground mt-0.5">{result.payoffProfile.maxLoss.note}</p>
                  )}
                </div>
                <div className="bg-muted/20 rounded px-2 py-1.5">
                  <p className="text-muted-foreground text-[10px] uppercase tracking-wide mb-0.5">Max Gain</p>
                  <p className="font-medium">
                    {result.payoffProfile.maxGain.type === "DEFINED"
                      ? (result.payoffProfile.maxGain.perContractDollars !== null ? `$${result.payoffProfile.maxGain.perContractDollars.toLocaleString()}` : "Defined")
                      : result.payoffProfile.maxGain.type === "SUBSTANTIAL"
                      ? "Substantial"
                      : result.payoffProfile.maxGain.type === "UNLIMITED"
                      ? "Unlimited (theoretical)"
                      : result.payoffProfile.maxGain.type}
                  </p>
                </div>
              </div>
              {result.payoffProfile.breakevens.length > 0 && (
                <div>
                  <p className="text-muted-foreground text-[10px] uppercase tracking-wide mb-1">Breakeven{result.payoffProfile.breakevens.length > 1 ? "s" : ""}</p>
                  <div className="flex flex-wrap gap-2">
                    {result.payoffProfile.breakevens.map((be, i) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        ${be.price.toFixed(2)} · {be.label}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {result.payoffProfile.payoffNote && (
                <p className="text-muted-foreground">{result.payoffProfile.payoffNote}</p>
              )}
            </CardContent>
          </Card>

          {/* Capital Profile */}
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Capital Profile</CardTitle>
            </CardHeader>
            <CardContent className="text-xs grid grid-cols-2 gap-2">
              {result.capitalProfile.netDebitPerContract !== null && (
                <div className="bg-muted/20 rounded px-2 py-1.5">
                  <p className="text-muted-foreground text-[10px] uppercase tracking-wide mb-0.5">Est. Debit</p>
                  <p className="font-medium">${result.capitalProfile.netDebitPerContract.toFixed(2)}/share · ${(result.capitalProfile.netDebitPerContract * 100).toLocaleString()}/contract</p>
                </div>
              )}
              {result.capitalProfile.netCreditPerContract !== null && (
                <div className="bg-muted/20 rounded px-2 py-1.5">
                  <p className="text-muted-foreground text-[10px] uppercase tracking-wide mb-0.5">Est. Credit</p>
                  <p className="font-medium">${result.capitalProfile.netCreditPerContract.toFixed(2)}/share · ${(result.capitalProfile.netCreditPerContract * 100).toLocaleString()}/contract</p>
                </div>
              )}
              {result.capitalProfile.estimatedScenarioCapital !== null && (
                <div className="bg-muted/20 rounded px-2 py-1.5 col-span-2">
                  <p className="text-muted-foreground text-[10px] uppercase tracking-wide mb-0.5">
                    {result.capitalProfile.estimatedScenarioCapitalNote || "Est. Capital"}
                  </p>
                  <p className="font-medium">${result.capitalProfile.estimatedScenarioCapital.toLocaleString()}/contract</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Price Scenarios */}
          {result.priceScenarios.length > 0 && (
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Price Scenarios — Hypothetical</CardTitle>
                <CardDescription className="text-xs">Expiration intrinsic payoff (exact) · Pre-expiration estimate (Δ approx)</CardDescription>
              </CardHeader>
              <CardContent className="text-xs overflow-x-auto">
                <table className="w-full min-w-[420px]">
                  <thead>
                    <tr className="text-muted-foreground text-[10px] uppercase tracking-wide border-b border-border/30">
                      <th className="text-left py-1 font-normal">Underlying</th>
                      <th className="text-left py-1 font-normal">Chg%</th>
                      <th className="text-right py-1 font-normal">Expiry P/L</th>
                      <th className="text-right py-1 font-normal">Pre-Expiry Est.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.priceScenarios.map((sc, i) => (
                      <tr key={i} className={`border-b border-border/10 last:border-0 ${sc.isCurrent ? "bg-muted/20" : ""}`}>
                        <td className="py-1">${sc.scenarioPrice.toFixed(2)}</td>
                        <td className={`py-1 ${sc.movePct > 0 ? "text-emerald-400" : sc.movePct < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                          {sc.movePct > 0 ? "+" : ""}{sc.movePct}%
                        </td>
                        <td className={`py-1 text-right font-medium ${sc.expirationIntrinsicPnlPerContract >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {sc.expirationIntrinsicPnlPerContract >= 0 ? "+" : ""}${sc.expirationIntrinsicPnlPerContract.toLocaleString()}
                        </td>
                        <td className="py-1 text-right text-muted-foreground">
                          {sc.deltaApproxPnlPerContract !== null
                            ? `${sc.deltaApproxPnlPerContract >= 0 ? "+" : ""}$${sc.deltaApproxPnlPerContract.toLocaleString()} ≈`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Greek Profile */}
          {(result.greekProfile.netDelta !== null || result.greekProfile.netTheta !== null) && (
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Greek Profile</CardTitle>
                {result.greekProfile.greeksCoveragePercent < 100 && (
                  <CardDescription className="text-xs">
                    {result.greekProfile.greeksCoveragePercent}% Greek coverage — some legs have unavailable data
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="text-xs space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  {result.greekProfile.netDelta !== null && (
                    <div className="bg-muted/20 rounded px-2 py-1.5">
                      <p className="text-muted-foreground text-[10px] uppercase tracking-wide mb-0.5">Net Delta</p>
                      <p className="font-medium">{result.greekProfile.netDelta.toFixed(3)}</p>
                    </div>
                  )}
                  {result.greekProfile.netTheta !== null && (
                    <div className="bg-muted/20 rounded px-2 py-1.5">
                      <p className="text-muted-foreground text-[10px] uppercase tracking-wide mb-0.5">Net Θ/day</p>
                      <p className="font-medium text-orange-300">{result.greekProfile.netTheta.toFixed(3)}</p>
                    </div>
                  )}
                  {result.greekProfile.netVega !== null && (
                    <div className="bg-muted/20 rounded px-2 py-1.5">
                      <p className="text-muted-foreground text-[10px] uppercase tracking-wide mb-0.5">Net Vega</p>
                      <p className="font-medium text-blue-300">{result.greekProfile.netVega.toFixed(3)}</p>
                    </div>
                  )}
                </div>
                {result.greekProfile.deltaInterpretation && (
                  <p className="text-muted-foreground">{result.greekProfile.deltaInterpretation}</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* IV Sensitivity */}
          {result.volatilityScenarios.length > 0 && (
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">IV Sensitivity — Hypothetical</CardTitle>
                <CardDescription className="text-xs">Vega approximation (labeled ≈)</CardDescription>
              </CardHeader>
              <CardContent className="text-xs overflow-x-auto">
                <table className="w-full min-w-[300px]">
                  <thead>
                    <tr className="text-muted-foreground text-[10px] uppercase tracking-wide border-b border-border/30">
                      <th className="text-left py-1 font-normal">IV Change</th>
                      <th className="text-right py-1 font-normal">Est. P/L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.volatilityScenarios.map((sc, i) => (
                      <tr key={i} className="border-b border-border/10 last:border-0">
                        <td className={`py-1 ${sc.ivRelativeChangePct > 0 ? "text-emerald-400" : sc.ivRelativeChangePct < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                          {sc.ivRelativeChangePct > 0 ? "+" : ""}{sc.ivRelativeChangePct}% <span className="text-muted-foreground text-[10px]">({sc.ivRelativeChangePctLabel})</span>
                        </td>
                        <td className={`py-1 text-right ${(sc.estimatedValueChangePerContract ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {sc.estimatedValueChangePerContract !== null
                            ? `${sc.estimatedValueChangePerContract >= 0 ? "+" : ""}$${sc.estimatedValueChangePerContract.toLocaleString()} ≈`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Time Decay */}
          {result.timeDecayScenarios.length > 0 && (
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Time Decay Checkpoints — Hypothetical</CardTitle>
                <CardDescription className="text-xs">Price held constant, theta approximation</CardDescription>
              </CardHeader>
              <CardContent className="text-xs space-y-1">
                {result.timeDecayScenarios.map((sc, i) => (
                  <div key={i} className="flex items-center justify-between py-1 border-b border-border/10 last:border-0">
                    <span className="text-muted-foreground">{sc.label}</span>
                    <span className={`font-medium ${(sc.cumulativeEstimatedDecayPerContract ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {sc.cumulativeEstimatedDecayPerContract !== null
                        ? `${sc.cumulativeEstimatedDecayPerContract >= 0 ? "+" : ""}$${sc.cumulativeEstimatedDecayPerContract.toLocaleString()} ≈`
                        : "—"}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Event Scenarios */}
          {result.eventScenarios.length > 0 && (
            <Card className="border-yellow-400/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-yellow-400">Event Exposure Scenarios</CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-2">
                {result.eventScenarios.map((ev, i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex items-start gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-yellow-400" />
                      <span className="font-medium text-yellow-400">{ev.eventType}{ev.eventDate ? ` (${ev.eventDate})` : ""}</span>
                    </div>
                    {ev.gapRiskNote && <p className="text-muted-foreground ml-5">{ev.gapRiskNote}</p>}
                    {ev.ivUncertaintyNote && <p className="text-muted-foreground ml-5">{ev.ivUncertaintyNote}</p>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Risk Flags */}
          {result.riskFlags.length > 0 && (
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Risk Flags</CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-2">
                {result.riskFlags.map((f, i) => <RiskFlagItem key={i} flag={f} />)}
              </CardContent>
            </Card>
          )}

          {/* Thesis Risk */}
          {(result.thesisRisk.invalidationNote || result.thesisRisk.researchThesisSummary) && (
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Thesis Risk</CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-1.5">
                {result.thesisRisk.researchThesisSummary && (
                  <p className="text-muted-foreground">{result.thesisRisk.researchThesisSummary}</p>
                )}
                {result.thesisRisk.invalidationNote && (
                  <div className="flex items-start gap-1.5 text-yellow-400 bg-yellow-400/5 border border-yellow-400/20 rounded p-2">
                    <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                    <span>{result.thesisRisk.invalidationNote}</span>
                  </div>
                )}
                {result.thesisRisk.thesisIntegrationNote && (
                  <p className="text-muted-foreground">{result.thesisRisk.thesisIntegrationNote}</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Liquidity & Quote Risk */}
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Liquidity &amp; Quote Risk</CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Liquidity category</span>
                <span>{result.liquidityRisk.overallLiquidityCategory}</span>
              </div>
              {result.liquidityRisk.widestBidAskSpreadPct !== null && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Widest bid-ask spread</span>
                  <span>{(result.liquidityRisk.widestBidAskSpreadPct * 100).toFixed(1)}%</span>
                </div>
              )}
              {result.liquidityRisk.lowestOpenInterest !== null && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Lowest open interest</span>
                  <span>{result.liquidityRisk.lowestOpenInterest.toLocaleString()}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Quote freshness</span>
                <span className={result.freshness.isStale ? "text-yellow-400" : "text-muted-foreground"}>
                  {result.freshness.isStale
                    ? `Stale${result.freshness.optionDataAge ? ` (${result.freshness.optionDataAge})` : ""}`
                    : "Current"}
                </span>
              </div>
              {result.liquidityRisk.executionNote && (
                <p className="text-muted-foreground pt-1 border-t border-border/30">{result.liquidityRisk.executionNote}</p>
              )}
              {result.quoteRisk.midpointNote && (
                <p className="text-muted-foreground">{result.quoteRisk.midpointNote}</p>
              )}
            </CardContent>
          </Card>

          {/* Constraint Check */}
          {result.constraintCheck.status !== "NO_CONSTRAINT_SET" && (
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  Planning Constraint Check
                  <ConstraintBadge check={result.constraintCheck} />
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-1 text-muted-foreground">
                {result.constraintCheck.statusNote && <p>{result.constraintCheck.statusNote}</p>}
                {result.constraintCheck.status === "EXCEEDS_CONSTRAINT" && (
                  <p className="text-yellow-400">
                    This structure's defined maximum loss exceeds your planning constraint. Consider reviewing contract research to find a structure with lower capital at risk.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Freshness */}
          {result.freshness.isStale && (
            <div className="flex items-start gap-1.5 text-xs text-yellow-400 bg-yellow-400/5 border border-yellow-400/20 rounded p-2">
              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
              <span>Market data may be stale{result.freshness.optionDataAge ? ` (${result.freshness.optionDataAge})` : ""}. Re-run contract research for fresh quotes before transacting.</span>
            </div>
          )}

          {/* Disclaimers */}
          <div className="p-3 rounded-lg bg-muted/30 border border-border/40 text-[10px] text-muted-foreground space-y-1">
            <p><Info className="h-3 w-3 inline mr-1" />{RISK_SCENARIO_DISCLAIMER}</p>
            <p>{MIDPOINT_EXECUTION_NOTE}</p>
          </div>

          {/* Recalculate */}
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={() => riskMutation.mutate()}
            disabled={riskMutation.isPending}
          >
            {riskMutation.isPending
              ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Recalculating…</>
              : <><RefreshCw className="h-3 w-3 mr-1.5" />Refresh Scenarios</>}
          </Button>
        </>
      )}
    </div>
  );
}

// Wrapper that manages the "is analyzing risk" state between panels
function ContractResearchAndRiskSection({ symbol, sessionId }: { symbol: string; sessionId: string }) {
  const [analysisCandidateId, setAnalysisCandidateId] = useState<string | null>(null);

  if (analysisCandidateId) {
    return (
      <RiskAnalysisPanel
        sessionId={sessionId}
        candidateId={analysisCandidateId}
        onBack={() => setAnalysisCandidateId(null)}
      />
    );
  }
  return (
    <ContractResearchPanel
      symbol={symbol}
      sessionId={sessionId}
      onAnalyzeRisk={(id) => setAnalysisCandidateId(id)}
    />
  );
}

// ===========================================================================
// Contract Research Panel — Sprint 2.7.3
// ===========================================================================

function ContractResearchCandidateCard({
  candidate,
  onAnalyzeRisk,
}: {
  candidate: OptionsStructureResearchCandidate;
  onAnalyzeRisk: (candidateId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const qualityColors: Record<string, string> = {
    EXCELLENT_DATA_QUALITY: "text-emerald-400 border-emerald-400/30 bg-emerald-400/5",
    STRONG_DATA_QUALITY:    "text-blue-400   border-blue-400/30   bg-blue-400/5",
    ACCEPTABLE_DATA_QUALITY:"text-yellow-400 border-yellow-400/30 bg-yellow-400/5",
    LIMITED_DATA:           "text-orange-400 border-orange-400/30 bg-orange-400/5",
  };
  const qColor = qualityColors[candidate.qualityCategory] ?? "text-muted-foreground border-border/50";
  const liqLabels: Record<string, string> = { STRONG: "Strong", ACCEPTABLE: "Acceptable", LIMITED: "Limited", POOR: "Poor", UNKNOWN: "Unknown" };

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between gap-2 p-3 hover:bg-muted/30 text-left"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <Badge variant="outline" className={`text-xs shrink-0 ${qColor}`}>
            {candidate.qualityCategory.replace(/_DATA_QUALITY|_DATA/, "").replace(/_/g, " ")}
          </Badge>
          <span className="text-xs font-medium truncate">
            {candidate.legs.map(l => `$${l.strike} ${l.optionType.toUpperCase()[0]}`).join(" / ")}
          </span>
          <span className="text-xs text-muted-foreground shrink-0">{candidate.expirationLabel}</span>
          <Badge variant="outline" className="text-xs shrink-0">
            {liqLabels[candidate.overallLiquidity] ?? candidate.overallLiquidity} Liquidity
          </Badge>
        </div>
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t border-border/40 p-3 space-y-3 text-xs">
          {/* Legs */}
          <div className="space-y-1.5">
            <p className="text-muted-foreground font-medium uppercase tracking-wide text-[10px]">Legs</p>
            {candidate.legs.map((leg, i) => (
              <div key={i} className="flex items-center justify-between gap-2 bg-muted/20 rounded px-2 py-1.5">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <span className="font-medium">{leg.roleLabel}</span>
                  <span className="text-muted-foreground">{leg.optionType.toUpperCase()} ${leg.strike}</span>
                  <Badge variant="outline" className="text-[10px] py-0">{leg.moneyness}</Badge>
                  {leg.delta !== null && <span className="text-muted-foreground">Δ {leg.delta.toFixed(2)}</span>}
                </div>
                <div className="text-right shrink-0 space-y-0.5">
                  <p>{leg.bid !== null ? `$${leg.bid.toFixed(2)}` : "—"} / {leg.ask !== null ? `$${leg.ask.toFixed(2)}` : "—"}</p>
                  {leg.midpoint !== null && <p className="text-muted-foreground">Mid ${leg.midpoint.toFixed(2)}</p>}
                </div>
              </div>
            ))}
          </div>

          {/* Structure Metrics */}
          <div className="grid grid-cols-2 gap-2">
            {candidate.metrics.debitCreditType && (
              <div className="bg-muted/20 rounded px-2 py-1.5">
                <p className="text-muted-foreground text-[10px] uppercase tracking-wide mb-0.5">Est. {candidate.metrics.debitCreditType}</p>
                <p className="font-medium">
                  {candidate.metrics.debitCreditType === "DEBIT"
                    ? (candidate.metrics.estimatedDebit !== null ? `$${candidate.metrics.estimatedDebit.toFixed(2)}/share` : "—")
                    : (candidate.metrics.estimatedCredit !== null ? `$${candidate.metrics.estimatedCredit.toFixed(2)}/share` : "—")}
                </p>
              </div>
            )}
            {candidate.metrics.width !== null && (
              <div className="bg-muted/20 rounded px-2 py-1.5">
                <p className="text-muted-foreground text-[10px] uppercase tracking-wide mb-0.5">Width</p>
                <p className="font-medium">${candidate.metrics.width.toFixed(2)}</p>
              </div>
            )}
            {candidate.metrics.capitalEstimate !== null && (
              <div className="bg-muted/20 rounded px-2 py-1.5 col-span-2">
                <p className="text-muted-foreground text-[10px] uppercase tracking-wide mb-0.5">Est. Cash-Secured Capital</p>
                <p className="font-medium">${candidate.metrics.capitalEstimate.toLocaleString()} per contract</p>
              </div>
            )}
            {candidate.metrics.isDefinedRisk !== null && (
              <div className="bg-muted/20 rounded px-2 py-1.5">
                <p className="text-muted-foreground text-[10px] uppercase tracking-wide mb-0.5">Risk Profile</p>
                <p className="font-medium">{candidate.metrics.isDefinedRisk ? "Defined Risk" : "Undefined Risk"}</p>
              </div>
            )}
          </div>

          {/* Greeks */}
          {(candidate.metrics.netDelta !== null || candidate.metrics.netTheta !== null) && (
            <div className="space-y-1">
              <p className="text-muted-foreground text-[10px] uppercase tracking-wide">Net Greeks (per contract)</p>
              <div className="flex flex-wrap gap-3">
                {candidate.metrics.netDelta !== null && <span>Δ {candidate.metrics.netDelta.toFixed(3)}</span>}
                {candidate.metrics.netTheta !== null && <span className="text-orange-300">Θ {candidate.metrics.netTheta.toFixed(3)}</span>}
                {candidate.metrics.netVega  !== null && <span className="text-blue-300">ν {candidate.metrics.netVega.toFixed(3)}</span>}
              </div>
            </div>
          )}

          {/* Event exposure */}
          {candidate.eventExposure.containsEarnings && (
            <div className="flex items-start gap-1.5 text-yellow-300 bg-yellow-400/5 border border-yellow-400/20 rounded p-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <p>{candidate.eventExposure.eventNote}</p>
            </div>
          )}

          {/* Warnings */}
          {candidate.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5 text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <p>{w}</p>
            </div>
          ))}

          {/* 2.7.4 CTA — active */}
          <div className="pt-1 border-t border-border/30">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs border-blue-500/40 text-blue-400 hover:bg-blue-500/10"
              onClick={() => onAnalyzeRisk(candidate.id)}
            >
              <BarChart2 className="h-3 w-3 mr-1.5" />
              Analyze Risk &amp; Scenarios
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ContractResearchPanel({ symbol, sessionId, onAnalyzeRisk }: {
  symbol: string;
  sessionId: string;
  onAnalyzeRisk: (candidateId: string) => void;
}) {
  const [strategyFamily, setStrategyFamily] = useState<string | null>(null);
  const [filtersOpen,    setFiltersOpen]    = useState(false);
  const [minOI,         setMinOI]          = useState<string>("10");
  const [maxSpread,     setMaxSpread]      = useState<string>("30");
  const [avoidEarnings, setAvoidEarnings]  = useState(false);

  // Get eligible families first
  const eligibilityQuery = useQuery<{
    eligibleFamilies: { strategyFamily: string; strategyLabel: string; status: string }[];
    thesisDirection: string;
  }>({
    queryKey: [`/api/trade-planning/session/${sessionId}/options/contracts`],
    queryFn:  () => apiRequest("GET", `/api/trade-planning/session/${sessionId}/options/contracts`).then(r => r.json()),
    enabled:  !!sessionId,
  });

  const eligible = eligibilityQuery.data?.eligibleFamilies ?? [];

  // Auto-select first family when loaded
  useEffect(() => {
    if (eligible.length > 0 && !strategyFamily) {
      setStrategyFamily(eligible[0].strategyFamily);
    }
  }, [eligible, strategyFamily]);

  // Run contract research for selected family
  const researchMutation = useMutation<{ result: OptionsContractResearchResult }, Error, string>({
    mutationFn: (family: string) =>
      apiRequest("POST", `/api/trade-planning/session/${sessionId}/options/contracts`, {
        strategyFamily: family,
        filtersOverride: {
          minOpenInterest:    parseInt(minOI) || 10,
          maxBidAskSpreadPct: parseFloat(maxSpread) / 100 || 0.30,
          avoidEarningsWindow: avoidEarnings,
        },
      }).then(r => r.json()),
  });

  const result = researchMutation.data?.result;

  return (
    <div className="space-y-4" aria-label="Options Contract Research">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" aria-hidden="true" />
          Contract &amp; Strike Research
        </h2>
        {result?.freshness?.staleWarning && (
          <Badge variant="outline" className="text-xs text-yellow-400 border-yellow-400/30">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Stale Chain
          </Badge>
        )}
      </div>

      {eligibilityQuery.isLoading ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading eligible strategy families…
          </CardContent>
        </Card>
      ) : eligible.length === 0 ? (
        <Card className="border-border/50">
          <CardContent className="p-4 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 inline mr-1" />
            No strategy families are eligible for contract research with your current constraints.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Strategy Family Selector */}
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Select Strategy Family</CardTitle>
              <CardDescription className="text-xs">Contract research is specific to one strategy structure.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Select value={strategyFamily ?? ""} onValueChange={setStrategyFamily}>
                <SelectTrigger className="w-full text-xs">
                  <SelectValue placeholder="Choose a strategy family…" />
                </SelectTrigger>
                <SelectContent>
                  {eligible.map(f => (
                    <SelectItem key={f.strategyFamily} value={f.strategyFamily} className="text-xs">
                      {f.strategyLabel}
                      {f.status === "POTENTIALLY_APPLICABLE" && (
                        <span className="ml-2 text-yellow-400">(Partial)</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Filter Controls */}
          <Card className="border-border/50">
            <button
              className="w-full flex items-center justify-between p-3 text-sm font-medium hover:bg-muted/20"
              onClick={() => setFiltersOpen(o => !o)}
              aria-expanded={filtersOpen}
            >
              <span className="flex items-center gap-2">
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
                Filter Controls
              </span>
              {filtersOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            {filtersOpen && (
              <CardContent className="pt-0 pb-3 space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="cr-min-oi" className="text-xs">Min Open Interest</Label>
                    <Input
                      id="cr-min-oi" type="number" min="0" value={minOI}
                      onChange={e => setMinOI(e.target.value)} className="h-7 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="cr-max-spread" className="text-xs">Max Spread % (bid/ask)</Label>
                    <Input
                      id="cr-max-spread" type="number" min="0" max="100" value={maxSpread}
                      onChange={e => setMaxSpread(e.target.value)} className="h-7 text-xs"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="cr-avoid-earnings" checked={avoidEarnings}
                    onCheckedChange={v => setAvoidEarnings(!!v)}
                  />
                  <Label htmlFor="cr-avoid-earnings" className="text-xs cursor-pointer">
                    Avoid earnings / event window expirations
                  </Label>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Run Research */}
          <Button
            className="w-full"
            disabled={!strategyFamily || researchMutation.isPending}
            onClick={() => strategyFamily && researchMutation.mutate(strategyFamily)}
          >
            {researchMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Loading live option chain…</>
            ) : (
              <><RefreshCw className="h-4 w-4 mr-2" />Run Contract Research</>
            )}
          </Button>

          {researchMutation.isError && (
            <Card className="border-red-400/30">
              <CardContent className="p-3 text-xs text-red-400 flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {researchMutation.error?.message ?? "Contract research failed. Ensure a broker is connected."}
              </CardContent>
            </Card>
          )}

          {result && (
            <div className="space-y-4">
              {/* Status + Freshness */}
              <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                <Badge variant="outline" className={
                  result.status === "COMPLETE"  ? "text-emerald-400 border-emerald-400/30" :
                  result.status === "PARTIAL"   ? "text-yellow-400 border-yellow-400/30"   :
                                                   "text-muted-foreground border-border/50"
                }>
                  {result.statusLabel}
                </Badge>
                <span className="text-muted-foreground">
                  Chain: {result.freshness.freshnessStatus} · {result.providerCallCount} broker call{result.providerCallCount !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Limitations */}
              {result.limitations.length > 0 && (
                <div className="space-y-1">
                  {result.limitations.map((l, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Info className="h-3 w-3 shrink-0 mt-0.5" /><span>{l}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Expiration Summary */}
              {result.expirationCandidates.length > 0 && (
                <Card className="border-border/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Expiration Research</CardTitle>
                    <CardDescription className="text-xs">
                      Target: {result.derivedDteRange.label}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1 text-xs">
                    {result.expirationCandidates.map((exp, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 py-1 border-b border-border/20 last:border-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{exp.expiration}</span>
                          <span className="text-muted-foreground">{exp.dte} DTE</span>
                          {exp.dteBucket && <Badge variant="outline" className="text-[10px] py-0">{exp.dteBucket.replace(/_/g, " ")}</Badge>}
                          {exp.containsEarnings && <Badge variant="outline" className="text-[10px] py-0 text-yellow-400 border-yellow-400/30">Event</Badge>}
                        </div>
                        <Badge variant="outline" className={`text-[10px] shrink-0 ${
                          exp.status === "RESEARCH_CANDIDATE" ? "text-emerald-400 border-emerald-400/30" :
                          exp.status === "EVENT_EXCLUDED"     ? "text-yellow-400 border-yellow-400/30"   :
                          exp.status === "OUTSIDE_HORIZON"    ? "text-muted-foreground"                  :
                                                                "text-red-400 border-red-400/30"
                        }`}>
                          {exp.status.replace(/_/g, " ")}
                        </Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Structure Candidates */}
              {result.structureCandidates.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    Structure Candidates ({result.structureCandidates.length})
                  </p>
                  {result.structureCandidates.map(c => (
                    <ContractResearchCandidateCard key={c.id} candidate={c} onAnalyzeRisk={onAnalyzeRisk} />
                  ))}
                </div>
              ) : (
                <Card className="border-border/50">
                  <CardContent className="p-4 text-xs text-muted-foreground">
                    <XCircle className="h-3.5 w-3.5 inline mr-1" />
                    No qualifying contract candidates found.
                    {result.rejectionSummary.contractsEvaluated > 0 && (
                      <span> {result.rejectionSummary.contractsEvaluated} contracts evaluated; {result.rejectionSummary.contractsRejected} rejected.</span>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Rejection Transparency */}
              {result.rejectionSummary.topRejectionReasons.length > 0 && (
                <Card className="border-border/50">
                  <CardHeader className="pb-1">
                    <CardTitle className="text-xs text-muted-foreground">Rejection Transparency</CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs space-y-1">
                    <p>{result.rejectionSummary.contractsEvaluated} evaluated · {result.rejectionSummary.contractsRejected} rejected</p>
                    {result.rejectionSummary.topRejectionReasons.map((r, i) => (
                      <div key={i} className="flex items-center justify-between text-muted-foreground">
                        <span>{r.reason}</span>
                        <span>{r.count}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Risk Disclosure */}
              <div className="p-3 rounded-lg bg-muted/30 border border-border/40 text-[10px] text-muted-foreground space-y-1">
                <p><Info className="h-3 w-3 inline mr-1" />{result.disclaimer}</p>
                <p>{result.midpointDisclaimer}</p>
              </div>
            </div>
          )}
        </>
      )}

      {/* Full risk disclosure */}
      <div className="p-3 rounded-lg bg-muted/30 border border-border/40 text-[10px] text-muted-foreground">
        <Shield className="h-3 w-3 inline mr-1" />
        {OPTIONS_RISK_DISCLOSURE_EXTENDED}
      </div>
    </div>
  );
}

function OptionsStrategyPanel({
  symbol, sessionId, constraints,
}: {
  symbol: string; sessionId: string; constraints: TradePlanningConstraints;
}) {
  const optionsQuery = useQuery<{ result: OptionsStrategyMatchResult }>({
    queryKey: [`/api/trade-planning/session/${sessionId}/options/matches`, constraints],
    queryFn:  () => apiRequest("GET", `/api/trade-planning/session/${sessionId}/options/matches`).then(r => r.json()),
    enabled:  !!sessionId,
  });

  const result = optionsQuery.data?.result;

  if (optionsQuery.isLoading) {
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Evaluating options strategy families…
        </CardContent>
      </Card>
    );
  }

  if (optionsQuery.isError || !result) {
    return (
      <Card className="border-border/50">
        <CardContent className="p-4 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 inline mr-1 text-yellow-400" />
          Options strategy evaluation unavailable — research data may be missing.
        </CardContent>
      </Card>
    );
  }

  const applicable         = result.matches.filter(m => m.status === "APPLICABLE");
  const potentiallyApplicable = result.matches.filter(m => m.status === "POTENTIALLY_APPLICABLE");
  const notApplicable      = result.matches.filter(m => m.status === "NOT_APPLICABLE");

  return (
    <div className="space-y-4" aria-label="Options Strategy Research">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-primary" aria-hidden="true" />
          Options Strategy Research
        </h2>
        {result.freshness?.hasStaleCriticalData && (
          <Badge variant="outline" className="text-xs text-yellow-400 border-yellow-400/30">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Stale Data
          </Badge>
        )}
      </div>

      {/* Thesis Direction + Context */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Research Thesis Direction
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant="outline" className="text-sm font-medium px-3 py-1">
              {result.thesisDirectionLabel}
            </Badge>
            {result.marketRegime && (
              <span className="text-xs text-muted-foreground">Market Regime: {result.marketRegime}</span>
            )}
            {result.researchHorizon && (
              <span className="text-xs text-muted-foreground">Horizon: {result.researchHorizon}</span>
            )}
          </div>
          {result.thesisDirectionReasoning.length > 0 && (
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {result.thesisDirectionReasoning.map((r, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="shrink-0 mt-0.5">•</span><span>{r}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Context summary row */}
          <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
            <div className="rounded bg-muted/30 p-2">
              <div className="text-muted-foreground mb-0.5">Volatility</div>
              <div className="font-medium">
                {result.volatilityContext.level === "UNKNOWN" ? "Unknown" : result.volatilityContext.level}
              </div>
              <div className="text-muted-foreground text-[10px] mt-0.5 line-clamp-2">{result.volatilityContext.note}</div>
            </div>
            <div className="rounded bg-muted/30 p-2">
              <div className="text-muted-foreground mb-0.5">Liquidity</div>
              <div className="font-medium">
                {result.liquidityContext.availability === "UNKNOWN" ? "Unknown" : result.liquidityContext.availability}
              </div>
              <div className="text-muted-foreground text-[10px] mt-0.5 line-clamp-2">{result.liquidityContext.note}</div>
            </div>
            <div className="rounded bg-muted/30 p-2">
              <div className="text-muted-foreground mb-0.5">Event Risk</div>
              <div className="font-medium">
                {result.eventContext?.hasUpcomingEvent ? "Detected" : "None Detected"}
              </div>
              {result.eventContext?.hasUpcomingEvent && (
                <div className="text-yellow-400 text-[10px] mt-0.5 line-clamp-2">{result.eventContext.note}</div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Planning Context quick summary */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded bg-muted/30 border border-border/40 p-2">
          <div className="text-muted-foreground mb-0.5">Portfolio</div>
          <div className="font-medium capitalize">{result.portfolioOwnership.replace("_", " ")}</div>
        </div>
        <div className="rounded bg-muted/30 border border-border/40 p-2">
          <div className="text-muted-foreground mb-0.5">Goal</div>
          <div className="font-medium">{result.goalContextLabel ?? "None"}</div>
        </div>
      </div>

      {/* Summary counts */}
      <div className="flex gap-3 text-xs flex-wrap">
        <span className="flex items-center gap-1.5 text-green-400">
          <span className="h-2 w-2 rounded-full bg-green-500 inline-block" />
          {result.applicableCount} Applicable
        </span>
        <span className="flex items-center gap-1.5 text-yellow-400">
          <span className="h-2 w-2 rounded-full bg-yellow-500 inline-block" />
          {result.potentialCount} Potentially Applicable
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-muted-foreground inline-block" />
          {result.notApplicableCount} Not Applicable
        </span>
      </div>

      {/* APPLICABLE group */}
      {applicable.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-green-400 uppercase tracking-wide">Applicable Families</p>
          {applicable.map(m => <StrategyFamilyCard key={m.strategyFamily} match={m} />)}
        </div>
      )}

      {/* POTENTIALLY_APPLICABLE group */}
      {potentiallyApplicable.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-yellow-400 uppercase tracking-wide">Potentially Applicable</p>
          {potentiallyApplicable.map(m => <StrategyFamilyCard key={m.strategyFamily} match={m} />)}
        </div>
      )}

      {/* NOT_APPLICABLE group */}
      {notApplicable.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Not Applicable</p>
          {notApplicable.map(m => <StrategyFamilyCard key={m.strategyFamily} match={m} />)}
        </div>
      )}

      {/* Result-level limitations */}
      {result.limitations.length > 0 && (
        <div className="p-3 rounded-lg bg-muted/30 border border-border/40 text-xs">
          <p className="font-medium mb-1 flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5 text-muted-foreground" />
            Research Limitations
          </p>
          <ul className="space-y-0.5 text-muted-foreground">
            {result.limitations.map((l, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="shrink-0 mt-0.5">•</span><span>{l}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Contract Research CTA (disabled — 2.7.3) */}
      <Card className="border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                Contract &amp; Strike Research
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Select an applicable strategy family above, then proceed to Contract Research to
                evaluate specific expirations and strikes. Available in Sprint 2.7.3.
              </p>
            </div>
            <Button size="sm" disabled className="gap-2 shrink-0 opacity-50" aria-disabled="true">
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              Contract Research
              <Badge variant="outline" className="text-[10px] ml-1">Upcoming</Badge>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* No recommendation note */}
      <div className="p-3 rounded-lg bg-muted/20 border border-border/30 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 inline mr-1" aria-hidden="true" />
        {NO_RECOMMENDATION_NOTE}
      </div>

      {/* Risk disclosure */}
      <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20 text-xs text-muted-foreground">
        <AlertCircle className="h-3.5 w-3.5 inline mr-1 text-red-400" aria-hidden="true" />
        {OPTIONS_RISK_DISCLOSURE}
      </div>

      {/* Strategy disclaimer */}
      <div className="p-3 rounded-lg bg-muted/20 border border-border/30 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 inline mr-1" aria-hidden="true" />
        {OPTIONS_STRATEGY_DISCLAIMER}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Planning constraints form
// ---------------------------------------------------------------------------

interface ConstraintsFormProps {
  constraints: TradePlanningConstraints;
  onChange:    (c: TradePlanningConstraints) => void;
}

function ConstraintsForm({ constraints, onChange }: ConstraintsFormProps) {
  const update = <K extends keyof TradePlanningConstraints>(key: K, value: TradePlanningConstraints[K]) =>
    onChange({ ...constraints, [key]: value });

  return (
    <div className="space-y-5" role="group" aria-label="Planning Constraints">
      {/* Disclaimer */}
      <div className="p-3 rounded-lg bg-muted/30 border border-border/40 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 inline mr-1 text-blue-400" aria-hidden="true" />
        {CONSTRAINTS_DISCLAIMER}
      </div>

      {/* Capital scenarios */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label htmlFor="capital-available" className="text-xs">
            Capital Available for Scenario
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-3 w-3 inline ml-1 text-muted-foreground" aria-label="Help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-[200px] text-xs">
                  Optional. Used to model scaling and cost scenarios only.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Label>
          <Input
            id="capital-available"
            type="number"
            min={0}
            step={1000}
            placeholder="e.g. 10000"
            value={constraints.capitalAvailable ?? ""}
            onChange={e => update("capitalAvailable", e.target.value ? Number(e.target.value) : undefined)}
            className="h-8 text-sm"
            aria-describedby="capital-available-hint"
          />
          <span id="capital-available-hint" className="sr-only">Dollar amount for scenario modeling only</span>
        </div>
        <div className="space-y-1">
          <Label htmlFor="max-capital-at-risk" className="text-xs">Maximum Capital at Risk</Label>
          <Input
            id="max-capital-at-risk"
            type="number"
            min={0}
            step={500}
            placeholder="e.g. 2000"
            value={constraints.maxCapitalAtRisk ?? ""}
            onChange={e => update("maxCapitalAtRisk", e.target.value ? Number(e.target.value) : undefined)}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="max-loss" className="text-xs">Maximum Loss per Position</Label>
          <Input
            id="max-loss"
            type="number"
            min={0}
            step={100}
            placeholder="e.g. 500"
            value={constraints.maxLossPerPosition ?? ""}
            onChange={e => update("maxLossPerPosition", e.target.value ? Number(e.target.value) : undefined)}
            className="h-8 text-sm"
          />
        </div>
      </div>

      {/* Horizon */}
      <div className="space-y-1">
        <Label htmlFor="horizon" className="text-xs">Planning Horizon</Label>
        <Select
          value={constraints.preferredHoldingPeriod ?? ""}
          onValueChange={v => update("preferredHoldingPeriod", v as TradePlanningConstraints["preferredHoldingPeriod"])}
        >
          <SelectTrigger id="horizon" className="h-8 text-sm w-[220px]" aria-label="Select planning horizon">
            <SelectValue placeholder="Not selected" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="short">Short (days to weeks)</SelectItem>
            <SelectItem value="medium">Medium (weeks to months)</SelectItem>
            <SelectItem value="long">Long (months+)</SelectItem>
            <SelectItem value="multi_year">Multi-Year</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Toggles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border/40">
          <Switch
            id="equity-allowed"
            checked={constraints.equityAllowed}
            onCheckedChange={v => update("equityAllowed", v)}
            aria-label="Equity research allowed"
          />
          <Label htmlFor="equity-allowed" className="text-xs cursor-pointer">Equity Research Allowed</Label>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border/40">
          <Switch
            id="options-allowed"
            checked={constraints.optionsAllowed}
            onCheckedChange={v => update("optionsAllowed", v)}
            aria-label="Options research allowed"
          />
          <Label htmlFor="options-allowed" className="text-xs cursor-pointer">Options Research Allowed</Label>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border/40">
          <Checkbox
            id="defined-risk"
            checked={constraints.definedRiskPreferred ?? false}
            onCheckedChange={v => update("definedRiskPreferred", !!v)}
            aria-label="Prefer defined-risk structures"
          />
          <Label htmlFor="defined-risk" className="text-xs cursor-pointer">Defined-Risk Preferred</Label>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border/40">
          <Checkbox
            id="income-focus"
            checked={constraints.incomeFocus ?? false}
            onCheckedChange={v => update("incomeFocus", !!v)}
            aria-label="Income-focused expressions"
          />
          <Label htmlFor="income-focus" className="text-xs cursor-pointer">Income Focus</Label>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border/40">
          <Checkbox
            id="directional-focus"
            checked={constraints.directionalFocus ?? false}
            onCheckedChange={v => update("directionalFocus", !!v)}
            aria-label="Directional focus"
          />
          <Label htmlFor="directional-focus" className="text-xs cursor-pointer">Directional Focus</Label>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border/40">
          <Checkbox
            id="avoid-earnings"
            checked={constraints.avoidEarningsWindow ?? false}
            onCheckedChange={v => update("avoidEarningsWindow", !!v)}
            aria-label="Note earnings windows"
          />
          <Label htmlFor="avoid-earnings" className="text-xs cursor-pointer">Note Earnings / Event Windows</Label>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Research context card
// ---------------------------------------------------------------------------

function ResearchContextCard({ ctx }: { ctx: TradePlanningContext }) {
  const scores = [
    { label: "Research", value: ctx.researchScore },
    { label: "Technical", value: ctx.technicalScore },
    { label: "Fundamental", value: ctx.fundamentalScore },
    { label: "Institutional", value: ctx.institutionalScore },
  ];

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">Research Context</CardTitle>
          <FreshnessTag
            status={ctx.freshness.opportunityIntelligence.status}
            label={ctx.freshness.opportunityIntelligence.label}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs">{ctx.opportunityLabel}</Badge>
          <Badge variant="outline" className="text-xs">{ctx.researchHorizon}</Badge>
          <Badge variant="outline" className={`text-xs ${
            ctx.riskLevel === "high" ? "text-red-400 border-red-400/30" :
            ctx.riskLevel === "low"  ? "text-green-400 border-green-400/30" :
                                       "text-yellow-400 border-yellow-400/30"
          }`}>
            {ctx.riskLevel} risk
          </Badge>
          {ctx.marketRegime && <Badge variant="outline" className="text-xs">{ctx.marketRegime}</Badge>}
        </div>

        {/* Scores */}
        <div className="grid grid-cols-4 gap-2">
          {scores.map(s => (
            <div key={s.label} className="text-center p-2 rounded-lg bg-muted/30">
              <div className="text-base font-bold">{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Themes */}
        {ctx.themes.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {ctx.themes.slice(0, 5).map(t => (
              <Badge key={t} variant="outline" className="text-xs px-1.5">{t}</Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Why qualified card
// ---------------------------------------------------------------------------

function WhyQualifiedCard({ ctx }: { ctx: TradePlanningContext }) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Why This Candidate Qualified</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {ctx.primaryEvidence.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Primary Evidence</p>
            {ctx.primaryEvidence.slice(0, 4).map((e, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs">
                <Check className="h-3 w-3 text-green-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <span className="font-medium">{e.label}</span>
                  {e.detail && <span className="text-muted-foreground"> — {e.detail}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        {ctx.secondaryEvidence.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Supporting Context</p>
            {ctx.secondaryEvidence.slice(0, 3).map((e, i) => (
              <div key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <ChevronRight className="h-3 w-3 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{e.label}{e.detail && ` — ${e.detail}`}</span>
              </div>
            ))}
          </div>
        )}
        {ctx.primaryEvidence.length === 0 && ctx.secondaryEvidence.length === 0 && (
          <p className="text-xs text-muted-foreground">Evidence details not available for this candidate.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Risk card
// ---------------------------------------------------------------------------

function RiskCard({ ctx }: { ctx: TradePlanningContext }) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Shield className="h-4 w-4 text-yellow-400" aria-hidden="true" />
          Risk & Thesis Invalidation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {ctx.riskFactors.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Risk Factors</p>
            {ctx.riskFactors.slice(0, 5).map((r, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs">
                <AlertTriangle className={`h-3 w-3 shrink-0 mt-0.5 ${
                  r.severity === "high" ? "text-red-400" : r.severity === "medium" ? "text-yellow-400" : "text-muted-foreground"
                }`} aria-label={`${r.severity} severity`} />
                <div>
                  <span className="font-medium">{r.label}</span>
                  {r.detail && <span className="text-muted-foreground"> — {r.detail}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        {ctx.invalidatesThesis.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Thesis Invalidation Signals</p>
            {ctx.invalidatesThesis.slice(0, 4).map((inv, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs">
                <XCircle className="h-3 w-3 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <span className="font-medium">{inv.condition}</span>
                  {inv.detail && <span className="text-muted-foreground"> — {inv.detail}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        {ctx.riskFactors.length === 0 && ctx.invalidatesThesis.length === 0 && (
          <p className="text-xs text-muted-foreground">No specific risk factors or invalidation conditions recorded.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Data freshness card
// ---------------------------------------------------------------------------

function DataFreshnessCard({ ctx }: { ctx: TradePlanningContext }) {
  const items = [
    { label: "Opportunity Intelligence", freshness: ctx.freshness.opportunityIntelligence },
    { label: "Technical Evidence",       freshness: ctx.freshness.technicalEvidence },
    { label: "Fundamental Evidence",     freshness: ctx.freshness.fundamentalEvidence },
    { label: "Institutional Evidence",   freshness: ctx.freshness.institutionalEvidence },
    { label: "Portfolio Context",        freshness: ctx.freshness.portfolioContext },
    { label: "Goal Context",             freshness: ctx.freshness.goalContext },
  ];

  const hasStale = items.some(i => i.freshness.status === "stale");

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Data Freshness
          </CardTitle>
          {hasStale && (
            <Badge variant="outline" className="text-xs text-yellow-400 border-yellow-400/30">
              <AlertTriangle className="h-3 w-3 mr-1" aria-hidden="true" />
              Refresh Suggested
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5">
          {items.map(item => (
            <div key={item.label} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{item.label}</span>
              <FreshnessTag status={item.freshness.status} label={item.freshness.label} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

// Reserved segments that must not be treated as ticker symbols
const RESERVED = new Set(["health", "session", "history", "templates", "metadata"]);

export default function TradePlanningPage() {
  const [, params] = useRoute("/trade-planning/:symbol");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const rawSymbol = params?.symbol ?? "";
  const symbol    = rawSymbol.toUpperCase();

  // Draft ID from URL query param — populated when user arrives from Order Preparation
  const activeDraftId = useMemo(() => {
    const sp = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    return sp.get("draftId") ?? null;
  }, []);

  const [constraints, setConstraints] = useState<TradePlanningConstraints>(DEFAULT_CONSTRAINTS);
  const [selectedFamily, setSelectedFamily] = useState<ExpressionFamily | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [constraintsOpen, setConstraintsOpen] = useState(false);

  // Validate symbol
  const isReserved = RESERVED.has(symbol);
  if (!symbol || isReserved) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-4">
        <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto" aria-hidden="true" />
        <p className="text-muted-foreground">Invalid trade planning target: {symbol || "(none)"}</p>
        <Link href="/dashboard"><Button variant="outline" size="sm">← Dashboard</Button></Link>
      </div>
    );
  }

  // Build context query (include constraints as query param)
  const contextQuery = useQuery<{
    context: TradePlanningContext;
    existingSession: { id: string } | null;
    disclaimer: string;
  }>({
    queryKey: [`/api/trade-planning/${symbol}/context`, sessionId],
    queryFn: async () => {
      const url = `/api/trade-planning/${symbol}/context`;
      const r = await apiRequest("GET", url);
      return r.json();
    },
  });

  const ctx = contextQuery.data?.context;

  // Seed constraints + session from first load
  useEffect(() => {
    if (contextQuery.data) {
      if (contextQuery.data.existingSession?.id && !sessionId) {
        setSessionId(contextQuery.data.existingSession.id);
      }
    }
  }, [contextQuery.data]);

  // Create session mutation
  const createSessionMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/trade-planning/session", {
        symbol,
        constraints,
        goalId:      ctx?.researchGoalId ?? null,
        portfolioId: ctx?.portfolioId ?? null,
      }).then(r => r.json()),
    onSuccess: (data) => {
      setSessionId(data.session.id);
      queryClient.invalidateQueries({ queryKey: [`/api/trade-planning/${symbol}/context`] });
      toast({ title: "Planning session saved" });
    },
    onError: () => toast({ title: "Failed to save session", variant: "destructive" }),
  });

  // Update session mutation
  const updateSessionMutation = useMutation({
    mutationFn: (patch: { constraints?: TradePlanningConstraints; selectedExpressionFamily?: ExpressionFamily | null }) =>
      apiRequest("PATCH", `/api/trade-planning/session/${sessionId}`, patch).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/trade-planning/${symbol}/context`] });
    },
    onError: () => toast({ title: "Failed to update session", variant: "destructive" }),
  });

  function handleSaveConstraints() {
    if (sessionId) {
      updateSessionMutation.mutate({ constraints });
    } else {
      createSessionMutation.mutate();
    }
  }

  function handleSelectFamily(f: ExpressionFamily) {
    setSelectedFamily(f === selectedFamily ? null : f);
    if (sessionId) {
      updateSessionMutation.mutate({ selectedExpressionFamily: f === selectedFamily ? null : f });
    }
  }

  const expressions = ctx?.eligibleExpressionFamilies ?? [];
  const applicable  = expressions.filter(e => e.status === "applicable");
  const potential   = expressions.filter(e => e.status === "potentially_applicable");
  const unavailable = expressions.filter(e => e.status === "unavailable");

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link href={`/opportunities/${symbol}`}>
              <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" aria-label="Back to opportunity workspace">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                {symbol}
              </Button>
            </Link>
          </div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Target className="h-6 w-6 text-primary" aria-hidden="true" />
            Trade Planning Research
          </h1>
          <p className="text-sm text-muted-foreground">
            Explore how a qualified research thesis could potentially be expressed through different investment structures.
          </p>
        </div>

        {/* Loading */}
        {contextQuery.isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" aria-label="Loading trade planning context" />
          </div>
        )}

        {/* 404 — no qualified candidate */}
        {contextQuery.isError && (
          <Card className="border-border/50">
            <CardContent className="p-8 text-center space-y-4">
              <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto" aria-hidden="true" />
              <div>
                <p className="font-semibold">{symbol} is not a current research candidate</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Trade Planning requires a qualified research candidate from the Opportunity Engine.
                </p>
              </div>
              <div className="flex justify-center gap-2">
                <Link href="/opportunities">
                  <Button size="sm" variant="outline">View Opportunities</Button>
                </Link>
                <Link href="/dashboard">
                  <Button size="sm" variant="outline">Dashboard</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Main content */}
        {ctx && (
          <div className="space-y-6">
            {/* Limitations banner */}
            {ctx.limitations.length > 0 && (
              <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 space-y-1">
                {ctx.limitations.map((l, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-yellow-300">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {l}
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Left column */}
              <div className="space-y-4">
                <ResearchContextCard ctx={ctx} />
                <WhyQualifiedCard ctx={ctx} />
              </div>

              {/* Right column */}
              <div className="space-y-4">
                {/* Goal context */}
                {ctx.goalContext && (
                  <Card className="border-border/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Research Goal</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{ctx.goalContext.goalName}</span>
                        <Badge variant="outline" className="text-xs capitalize">
                          {ctx.goalContext.matchState.replace(/_/g, " ")}
                        </Badge>
                      </div>
                      <div className="text-muted-foreground">
                        {ctx.goalContext.goalType.replace(/_/g, " ")} · {ctx.goalContext.horizon.replace(/_/g, " ")}
                      </div>
                      {ctx.goalContext.preferredThemes.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {ctx.goalContext.preferredThemes.slice(0, 3).map(t => (
                            <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Portfolio context */}
                {ctx.portfolioContext && (
                  <Card className="border-border/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Portfolio Context</CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span>{ctx.portfolioContext.portfolioName}</span>
                        <Badge variant="outline" className={`text-xs ${ctx.portfolioContext.ownsSymbol ? "text-green-400 border-green-400/30" : ""}`}>
                          {ctx.portfolioContext.ownsSymbol ? "Position Exists" : "Not Held"}
                        </Badge>
                      </div>
                      {ctx.portfolioContext.ownsSymbol && (
                        <div className="grid grid-cols-2 gap-2">
                          {ctx.portfolioContext.positionSize != null && (
                            <div><span className="text-muted-foreground">Size:</span> {ctx.portfolioContext.positionSize} shares</div>
                          )}
                          {ctx.portfolioContext.portfolioWeight != null && (
                            <div><span className="text-muted-foreground">Weight:</span> {ctx.portfolioContext.portfolioWeight.toFixed(1)}%</div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                <RiskCard ctx={ctx} />
                <DataFreshnessCard ctx={ctx} />
              </div>
            </div>

            {/* Planning Constraints */}
            <Card className="border-border/50">
              <CardHeader
                className="pb-2 cursor-pointer"
                onClick={() => setConstraintsOpen(x => !x)}
              >
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Planning Constraints</CardTitle>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Optional</span>
                    {constraintsOpen
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                  </div>
                </div>
                <CardDescription className="text-xs">
                  Optional parameters used only to shape which research expressions are explored
                </CardDescription>
              </CardHeader>
              {constraintsOpen && (
                <CardContent className="space-y-4">
                  <ConstraintsForm constraints={constraints} onChange={setConstraints} />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleSaveConstraints}
                      disabled={createSessionMutation.isPending || updateSessionMutation.isPending}
                      className="gap-1.5"
                    >
                      {(createSessionMutation.isPending || updateSessionMutation.isPending)
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                      Save &amp; Apply Constraints
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConstraints(DEFAULT_CONSTRAINTS)}
                    >
                      Reset
                    </Button>
                  </div>
                </CardContent>
              )}
            </Card>

            {/* Expression Families */}
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold">Potential Research Expressions</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">{NO_RANKING_DISCLAIMER}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 shrink-0"
                  onClick={() => contextQuery.refetch()}
                  aria-label="Refresh expressions"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>

              {/* Applicable */}
              {applicable.length > 0 && (
                <div className="space-y-2" role="radiogroup" aria-label="Applicable research expressions">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Applicable
                  </p>
                  {applicable.map(e => (
                    <ExpressionCard
                      key={e.family}
                      result={e}
                      selected={selectedFamily === e.family}
                      onSelect={handleSelectFamily}
                    />
                  ))}
                </div>
              )}

              {/* Potentially applicable */}
              {potential.length > 0 && (
                <div className="space-y-2" role="radiogroup" aria-label="Potentially applicable research expressions">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Potentially Applicable
                  </p>
                  {potential.map(e => (
                    <ExpressionCard
                      key={e.family}
                      result={e}
                      selected={selectedFamily === e.family}
                      onSelect={handleSelectFamily}
                    />
                  ))}
                </div>
              )}

              {/* Unavailable */}
              {unavailable.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Unavailable
                  </p>
                  {unavailable.map(e => (
                    <ExpressionCard
                      key={e.family}
                      result={e}
                      selected={false}
                      onSelect={() => {}}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Research Workspace CTA */}
            {selectedFamily && (
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-medium">Explain This Research Expression</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Open Research Workspace to explore the context of this expression approach.
                        AI can explain — but cannot construct a trade or select a contract.
                      </p>
                    </div>
                    <Link href={`/research-workspace?symbol=${symbol}&mode=company&action=explain_concept`}>
                      <Button size="sm" className="gap-2 shrink-0" aria-label="Open Research Workspace for explanation">
                        <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                        Research Workspace
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Equity Planning Panel — shown when equity or equity_scaled selected */}
            {(selectedFamily === "equity" || selectedFamily === "equity_scaled") && sessionId && (
              <EquityPlanningPanel symbol={symbol} sessionId={sessionId} constraints={constraints} />
            )}

            {/* Equity Order Preview — Sprint 2.8.2
                Shown when STOCK expression is selected and a draftId is present in the URL.
                Non-executable: "Preview Only — Nothing has been submitted to your broker."
                Follows Order Preparation → Equity Preview → (2.8.5) Final Execution Validation. */}
            {(selectedFamily === "equity" || selectedFamily === "equity_scaled") && activeDraftId && (
              <EquityOrderPreviewPanel
                draftId={activeDraftId}
                onEditDraft={() => window.history.back()}
              />
            )}

            {/* Options Order Preview — Sprint 2.8.3
                Shown when any options-family expression is selected and a draftId is in the URL.
                instrumentType must be OPTION or MULTI_LEG_OPTION.
                Non-executable: "Preview Only — Nothing has been submitted to your broker."
                No Confirm, Submit, or Execute actions.
                No leg decomposition for multi-leg structures.
                Pipeline: Trade Plan → Preflight → Order Draft → Options Preview → (2.8.5) Final Validation */}
            {activeDraftId && selectedFamily && [
              "long_option", "income", "defined_risk_directional",
              "covered_call", "cash_secured_put", "vertical_spread",
              "neutral_options", "advanced_options",
            ].includes(selectedFamily) && (
              <OptionsOrderPreviewPanel
                draftId={activeDraftId}
                onEditDraft={() => window.history.back()}
              />
            )}

            {/* Options Strategy Panel — shown when any options-related family selected */}
            {selectedFamily && sessionId && (
              selectedFamily === "income" ||
              selectedFamily === "defined_risk_directional" ||
              selectedFamily === "covered_call" ||
              selectedFamily === "cash_secured_put" ||
              selectedFamily === "vertical_spread" ||
              selectedFamily === "long_option" ||
              selectedFamily === "neutral_options"
            ) && (
              <OptionsStrategyPanel symbol={symbol} sessionId={sessionId} constraints={constraints} />
            )}

            {/* Contract Research Panel + Risk Analysis Panel */}
            {selectedFamily && sessionId && (
              selectedFamily === "income" ||
              selectedFamily === "defined_risk_directional" ||
              selectedFamily === "covered_call" ||
              selectedFamily === "cash_secured_put" ||
              selectedFamily === "vertical_spread" ||
              selectedFamily === "long_option" ||
              selectedFamily === "neutral_options"
            ) && (
              <ContractResearchAndRiskSection symbol={symbol} sessionId={sessionId} />
            )}

            {/* Save Research Plan CTA — Sprint 2.7.5 */}
            {sessionId && (
              <Card className="border-primary/30 bg-primary/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Save Research Plan</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    A Trade Plan saves the thesis, planning structure, risk analysis, and monitoring conditions you selected — as a persistent research record.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => window.location.href = "/trade-plans"}
                    >
                      View Trade Plans
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Future Planning Steps */}
            <Card className="border-border/50 opacity-70">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Future Planning Steps</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <p className="text-foreground font-medium">Coming in future sprints:</p>
                <p>• <strong className="text-foreground">Order Preparation</strong> — Upcoming</p>
              </CardContent>
            </Card>

            {/* Compliance */}
            <div className="p-4 rounded-lg bg-muted/30 border border-border/40 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 inline mr-1" aria-hidden="true" />
              {TRADE_PLANNING_DISCLAIMER}
            </div>

            {/* Session indicator */}
            {sessionId && (
              <p className="text-xs text-muted-foreground text-center">
                Session saved · Constraints preserved for this symbol
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
