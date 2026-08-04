// Sprint 4B — Unified TradePlanCard.
// Renders a TradePlanViewModel produced by fromRankedCandidate() or
// fromRecIdea(). Never accesses raw server payloads; never fabricates values.
//
// Layout (spec §2):
//   Top row     — Rank · Symbol · Verdict · Direction · Confidence
//   Primary     — Current Price · Trigger · Distance · Invalidation · Objective · R/R
//   Risk        — Max Risk · Quantity · Earnings Risk · Data Quality
//   Decision    — Why selected · Why not actionable · What would change verdict
//   CTAs        — verdict-aware action buttons (spec §4)
//
// Use showDecision={false} when the parent renders a richer WhySection.

import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  computeDistanceToTrigger,
  computeTradeStatus,
  isTradePlanBuilderEligible,
  tradePlanCtas,
  tradeStatusBadgeClass,
  tradeStatusLabel,
  type TradePlanViewModel,
} from "@/lib/trade-plan-view-model";

// ---------------------------------------------------------------------------
// Verdict display maps
// ---------------------------------------------------------------------------

const VERDICT_LABELS: Record<string, string> = {
  STOCK: "Trade Candidate",
  LIVE_OPTIONS: "Live Options",
  ESTIMATED_OPTIONS: "Options Estimate",
  WATCH: "Watch — Not Actionable",
  NO_TRADE: "No Trade",
  UNSUPPORTED: "Unsupported",
  UNAVAILABLE: "Data Unavailable",
};

const CARD_BORDER: Record<string, string> = {
  STOCK: "border-emerald-500/25 bg-emerald-500/5",
  LIVE_OPTIONS: "border-emerald-500/25 bg-emerald-500/5",
  ESTIMATED_OPTIONS: "border-amber-500/25 bg-amber-500/5",
  WATCH: "border-amber-500/25 bg-amber-500/5",
  NO_TRADE: "border-border bg-muted/5",
  UNSUPPORTED: "border-sky-500/25 bg-sky-500/5",
  UNAVAILABLE: "border-border bg-muted/5",
};

const VERDICT_BADGE: Record<string, string> = {
  STOCK: "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
  LIVE_OPTIONS: "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
  ESTIMATED_OPTIONS: "border-amber-500/40 text-amber-300 bg-amber-500/10",
  WATCH: "border-amber-500/40 text-amber-300 bg-amber-500/10",
  NO_TRADE: "border-muted text-muted-foreground bg-muted/20",
  UNSUPPORTED: "border-sky-500/40 text-sky-300 bg-sky-500/10",
  UNAVAILABLE: "border-muted text-muted-foreground bg-muted/20",
};

// ---------------------------------------------------------------------------
// Trigger state display
// ---------------------------------------------------------------------------

const TRIGGER_STATE_LABEL: Record<string, string> = {
  TRIGGERED: "Trigger confirmed",
  AWAITING_TRIGGER: "Awaiting breakout",
  EVENT_CONFIRMATION: "Event confirmation required",
  NO_TRIGGER: "No trigger",
  UNKNOWN: "Trigger set",
};

const TRIGGER_STATE_CLASS: Record<string, string> = {
  TRIGGERED: "text-emerald-400",
  AWAITING_TRIGGER: "text-sky-400",
  EVENT_CONFIRMATION: "text-amber-400",
  UNKNOWN: "text-muted-foreground",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Field({
  label,
  value,
  testId,
}: {
  label: string;
  value: string | number | null | undefined;
  testId?: string;
}) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-medium truncate" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

function CtaRow({
  vm,
  testId,
}: {
  vm: TradePlanViewModel;
  testId: string;
}) {
  const ctas = tradePlanCtas(vm);
  if (ctas.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 pt-1" data-testid={testId} role="group" aria-label="Trade actions">
      {ctas.map((cta) => (
        <Button key={cta.label} asChild size="sm" variant={cta.primary ? "default" : "outline"} className="h-7 text-xs">
          <Link href={cta.href}>{cta.label}</Link>
        </Button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TradePlanCard (exported)
// ---------------------------------------------------------------------------

interface TradePlanCardProps {
  vm: TradePlanViewModel;
  /** Extra content appended to the top badge row (e.g. simulatedData badge). */
  headerExtra?: React.ReactNode;
  /**
   * When false, the Decision section (why selected / why not actionable) is
   * omitted. Set to false when the parent renders a richer WhySection.
   * Defaults to true.
   */
  showDecision?: boolean;
}

export function TradePlanCard({ vm, headerExtra, showDecision = true }: TradePlanCardProps) {
  const borderClass = CARD_BORDER[vm.verdict] ?? "border-border";
  // Sprint 4.1C — unified status: never generic "No Trade"
  const activeStatus = vm.tradeStatus ?? computeTradeStatus(vm);
  const statusBadge  = tradeStatusBadgeClass(activeStatus);
  const statusLbl    = tradeStatusLabel(vm);
  const triggerStateLabel = TRIGGER_STATE_LABEL[vm.triggerState];
  const triggerStateClass = TRIGGER_STATE_CLASS[vm.triggerState] ?? "";
  const hasTrigger = vm.triggerState !== "NO_TRIGGER";
  const isPositive =
    vm.verdict === "STOCK" || vm.verdict === "LIVE_OPTIONS" || vm.verdict === "ESTIMATED_OPTIONS";
  const isWatchOrNo = vm.verdict === "WATCH" || vm.verdict === "NO_TRADE";

  return (
    <article
      className={`rounded-lg border p-3 space-y-3 ${borderClass}`}
      data-testid={`card-trade-plan-${vm.symbol}`}
      aria-label={`Trade plan for ${vm.symbol}: ${statusLbl}`}
    >
      {/* ── Top row ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {vm.rank != null && (
          <Badge
            variant="outline"
            className="border-sky-500/40 text-sky-300 bg-sky-500/10"
            data-testid={`badge-trade-plan-rank-${vm.symbol}`}
            aria-label={`Ranked number ${vm.rank}`}
          >
            Rank #{vm.rank}
          </Badge>
        )}
        <span className="font-semibold text-base" data-testid={`text-trade-plan-symbol-${vm.symbol}`}>
          {vm.symbol}
        </span>
        {/* Primary status badge — never generic "No Trade" */}
        <Badge
          variant="outline"
          className={statusBadge}
          data-testid={`badge-trade-plan-verdict-${vm.symbol}`}
        >
          {statusLbl}
        </Badge>
        {vm.direction && (
          <Badge
            variant="outline"
            className="border-indigo-500/40 text-indigo-300 bg-indigo-500/10"
            data-testid={`badge-trade-plan-direction-${vm.symbol}`}
          >
            {vm.direction}
          </Badge>
        )}
        {vm.confidence && (
          <Badge
            variant="outline"
            className="border-muted-foreground/30 text-muted-foreground"
            data-testid={`badge-trade-plan-confidence-${vm.symbol}`}
          >
            {vm.confidence} confidence
          </Badge>
        )}
        {vm.strategyScore != null && (
          <Badge
            variant="outline"
            className="border-muted-foreground/30 text-muted-foreground"
            data-testid={`badge-trade-plan-score-${vm.symbol}`}
          >
            Score {vm.strategyScore}
          </Badge>
        )}
        {vm.strategy && (
          <Badge
            variant="outline"
            className="border-muted-foreground/30 text-muted-foreground text-[10px]"
            data-testid={`badge-trade-plan-strategy-${vm.symbol}`}
          >
            {vm.strategy}
          </Badge>
        )}
        {vm.simulatedData && (
          <Badge
            variant="outline"
            className="text-[10px] text-purple-300 border-purple-500/40 bg-purple-500/10"
            data-testid={`badge-trade-plan-simulated-${vm.symbol}`}
          >
            Simulated Data
          </Badge>
        )}
        {vm.verdict === "ESTIMATED_OPTIONS" && (
          <Badge variant="outline" className="text-[10px] text-amber-300 border-amber-500/40 bg-amber-500/10">
            Estimates — no live chain
          </Badge>
        )}
        {headerExtra}
      </div>

      {/* ── Status note (instrument / setupStatus) ───────────────── */}
      {(vm.instrument || vm.status) && (
        <div className="text-xs text-muted-foreground" data-testid={`text-trade-plan-status-${vm.symbol}`}>
          {[vm.instrument, vm.status].filter(Boolean).join(" · ")}
        </div>
      )}

      {/* ── Primary metrics grid ─────────────────────────────────── */}
      <div
        className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2"
        data-testid={`grid-trade-plan-metrics-${vm.symbol}`}
        aria-label="Trade plan metrics"
      >
        {vm.currentPrice != null && (
          <Field label="Current Price" value={`$${vm.currentPrice.toFixed(2)}`} testId={`field-trade-plan-price-${vm.symbol}`} />
        )}

        {/* Trigger with inline state label */}
        {hasTrigger ? (
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Entry Trigger</div>
            <div className="text-sm font-medium" data-testid={`field-trade-plan-trigger-${vm.symbol}`}>
              {vm.trigger}
              <span
                className={`ml-1.5 text-[10px] font-normal ${triggerStateClass}`}
                data-testid={`badge-trade-plan-trigger-state-${vm.symbol}`}
                aria-label={`Trigger state: ${triggerStateLabel}`}
              >
                ({triggerStateLabel})
              </span>
            </div>
          </div>
        ) : (
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Entry Trigger</div>
            <div className="text-sm text-muted-foreground/60 italic" data-testid={`field-trade-plan-trigger-${vm.symbol}`}>
              No trigger
            </div>
          </div>
        )}

        {/* Distance to trigger — only when meaningful */}
        {vm.distanceToTrigger && (
          <Field
            label="Distance to Trigger"
            value={vm.distanceToTrigger}
            testId={`field-trade-plan-distance-${vm.symbol}`}
          />
        )}

        <Field label="Invalidation" value={vm.invalidation} testId={`field-trade-plan-invalidation-${vm.symbol}`} />
        <Field label="Objective" value={vm.objective} testId={`field-trade-plan-objective-${vm.symbol}`} />
        <Field label="Risk / Reward" value={vm.rewardRisk != null ? `${vm.rewardRisk}:1` : undefined} testId={`field-trade-plan-rr-${vm.symbol}`} />
      </div>

      {/* ── Risk section ─────────────────────────────────────────── */}
      {(vm.maxRisk != null || vm.suggestedQuantity != null || vm.earningsRisk || vm.dataQuality) && (
        <div
          className="rounded-md border border-border/50 bg-muted/10 p-2.5 space-y-1.5"
          data-testid={`section-trade-plan-risk-${vm.symbol}`}
          aria-label="Risk details"
        >
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Risk</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5 text-xs">
            {vm.maxRisk != null && (
              <div data-testid={`field-trade-plan-max-risk-${vm.symbol}`}>
                <span className="text-muted-foreground">Max risk: </span>
                <span className={vm.maxRiskIsExact ? "" : "text-amber-300/90"}>
                  {vm.maxRiskIsExact ? "" : "~"}${vm.maxRisk.toLocaleString()}
                </span>
                {!vm.maxRiskIsExact && (
                  <span className="text-muted-foreground text-[9px] ml-1">(est.)</span>
                )}
              </div>
            )}
            {vm.suggestedQuantity != null && (
              <div data-testid={`field-trade-plan-quantity-${vm.symbol}`}>
                <span className="text-muted-foreground">Qty: </span>
                <span>{vm.suggestedQuantity}</span>
              </div>
            )}
            {vm.dataQuality && (
              <div data-testid={`field-trade-plan-data-quality-${vm.symbol}`}>
                <span className="text-muted-foreground">Data: </span>
                <span className="text-purple-300/90">{vm.dataQuality}</span>
              </div>
            )}
            {vm.earningsRisk && (
              <div data-testid={`badge-trade-plan-earnings-risk-${vm.symbol}`} className="col-span-full">
                <Badge variant="outline" className="text-[10px] border-red-500/40 text-red-300 bg-red-500/10">
                  ⚠ Earnings Risk
                </Badge>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Decision section ─────────────────────────────────────── */}
      {showDecision && (
        <>
          {/* Why selected */}
          {vm.reasons.length > 0 && isPositive && (
            <div className="space-y-1" data-testid={`section-trade-plan-reasons-${vm.symbol}`} aria-label="Why selected">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Why selected</div>
              <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                {vm.reasons.map((r, i) => (
                  <li key={i} data-testid={`text-trade-plan-reason-${vm.symbol}-${i}`}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Why not actionable */}
          {vm.reasons.length > 0 && isWatchOrNo && (
            <div className="space-y-1" data-testid={`section-trade-plan-no-action-${vm.symbol}`} aria-label="Why not actionable">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Why it's not actionable</div>
              <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                {vm.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {/* What would change the verdict */}
          {(vm.watchConditions ?? []).length > 0 && (
            <div className="space-y-1" data-testid={`section-trade-plan-conditions-${vm.symbol}`} aria-label="What would change the verdict">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">What would change the verdict</div>
              <ul className="text-xs list-disc pl-4 space-y-0.5">
                {vm.watchConditions!.map((c, i) => (
                  <li key={i} className="text-amber-200/80">{c}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* ── Warnings ─────────────────────────────────────────────── */}
      {vm.warnings.length > 0 && (
        <ul
          className="text-xs text-amber-300/90 list-disc pl-4 space-y-0.5"
          data-testid={`list-trade-plan-warnings-${vm.symbol}`}
          aria-label="Warnings"
        >
          {vm.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      {/* ── CTA row ─────────────────────────────────────────────── */}
      <CtaRow vm={vm} testId={`ctas-trade-plan-${vm.symbol}`} />
    </article>
  );
}
