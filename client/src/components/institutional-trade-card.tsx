// Sprint 4.1B — Institutional Trade Card.
// Presents every trade recommendation in an equity-research style layout:
// Header → Trade Plan → Supporting Evidence → Risk → Decision → WHY →
// Warnings → CTAs.
//
// Uses TradePlanViewModel exclusively — never accesses raw server payloads.
// Compatible with ranked candidates (fromRankedCandidate),
// watch candidates (fromRankedWatchCandidate), and recommendation ideas
// (fromRecIdea).
//
// Rules (presentation-only — no logic changes):
//   • Never fabricate values; render only fields that are set on the VM.
//   • Decision section is the authoritative verdict display.
//   • Warning icons are categorized (earnings / liquidity / options / regime).
//   • CTA set is verdict-aware via tradePlanCtas().

import { Link } from "wouter";
import {
  AlertTriangle,
  BarChart2,
  CheckCircle2,
  Clock,
  Eye,
  MinusCircle,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  computeTradeStatus,
  isTradePlanBuilderEligible,
  tradePlanCtas,
  tradeStatusBadgeClass,
  tradeStatusLabel,
  type TradeCardStatus,
  type TradePlanViewModel,
} from "@/lib/trade-plan-view-model";

// ---------------------------------------------------------------------------
// Verdict display maps
// ---------------------------------------------------------------------------

/** Card border color — still driven by the original verdict bucket. */
const CARD_BORDER: Record<string, string> = {
  STOCK:             "border-emerald-500/30 bg-emerald-500/4",
  LIVE_OPTIONS:      "border-emerald-500/30 bg-emerald-500/4",
  ESTIMATED_OPTIONS: "border-amber-500/30 bg-amber-500/4",
  WATCH:             "border-amber-500/30 bg-amber-500/4",
  NO_TRADE:          "border-border bg-muted/5",
  UNSUPPORTED:       "border-sky-500/30 bg-sky-500/4",
  UNAVAILABLE:       "border-border bg-muted/5",
};

/**
 * Secondary instrument-type label badge.
 * Shows the underlying asset type when it adds meaningful context beyond the
 * primary TradeCardStatus badge (e.g. "Live Options" vs "Options Estimate").
 * Only rendered when this label differs from the primary status label.
 */
const INSTRUMENT_LABELS: Record<string, string> = {
  STOCK:             "Equity",
  LIVE_OPTIONS:      "Live Options",
  ESTIMATED_OPTIONS: "Options — No Live Chain",
  WATCH:             "",
  NO_TRADE:          "",
  UNSUPPORTED:       "Unsupported Structure",
  UNAVAILABLE:       "",
};

// Trigger state
const TRIGGER_STATE_LABEL: Record<string, string> = {
  TRIGGERED:          "Trigger confirmed",
  AWAITING_TRIGGER:   "Awaiting breakout",
  EVENT_CONFIRMATION: "Event confirmation required",
  NO_TRIGGER:         "No trigger set",
  UNKNOWN:            "Trigger set",
};

const TRIGGER_STATE_CLASS: Record<string, string> = {
  TRIGGERED:          "text-emerald-400",
  AWAITING_TRIGGER:   "text-sky-400",
  EVENT_CONFIRMATION: "text-amber-400",
  NO_TRIGGER:         "text-muted-foreground/60",
  UNKNOWN:            "text-muted-foreground",
};

// ---------------------------------------------------------------------------
// Status-driven Decision section config (Sprint 4.1C)
// ---------------------------------------------------------------------------

interface DecisionConfig {
  label: string;
  icon: React.ReactNode;
  border: string;
  bg: string;
  text: string;
}

/**
 * Returns Decision-section config driven by the TradeCardStatus.
 * Never produces a generic "No Trade" label — all statuses map to a specific
 * trader-facing description via tradeStatusLabel().
 */
function statusDecisionConfig(status: TradeCardStatus, vm: TradePlanViewModel): DecisionConfig {
  const label = tradeStatusLabel(vm);
  // Qualified family (TRADE_READY / TRIGGERED / AWAITING_BREAKOUT for equity verdicts)
  const isQualified =
    vm.verdict === "STOCK" || vm.verdict === "LIVE_OPTIONS" || vm.verdict === "ESTIMATED_OPTIONS";

  switch (status) {
    case "TRADE_READY":
      return { label, icon: <CheckCircle2 className="h-4 w-4 shrink-0" />, border: "border-emerald-500/40", bg: "bg-emerald-500/8", text: "text-emerald-300" };
    case "TRIGGERED":
      return { label, icon: <CheckCircle2 className="h-4 w-4 shrink-0" />, border: "border-emerald-400/60", bg: "bg-emerald-500/12", text: "text-emerald-200" };
    case "AWAITING_BREAKOUT":
      return isQualified
        ? { label, icon: <Clock className="h-4 w-4 shrink-0" />, border: "border-sky-500/40", bg: "bg-sky-500/8", text: "text-sky-300" }
        : { label, icon: <Clock className="h-4 w-4 shrink-0" />, border: "border-amber-500/40", bg: "bg-amber-500/8", text: "text-amber-300" };
    case "WATCH":
      return { label, icon: <Eye className="h-4 w-4 shrink-0" />, border: "border-amber-500/40", bg: "bg-amber-500/8", text: "text-amber-300" };
    case "EARNINGS_HOLD":
      return { label, icon: <AlertTriangle className="h-4 w-4 shrink-0" />, border: "border-orange-500/40", bg: "bg-orange-500/8", text: "text-orange-300" };
    case "DATA_LIMITED":
      return { label, icon: <BarChart2 className="h-4 w-4 shrink-0" />, border: "border-purple-500/40", bg: "bg-purple-500/8", text: "text-purple-300" };
    case "MARKET_UNAVAILABLE":
      return { label, icon: <MinusCircle className="h-4 w-4 shrink-0" />, border: "border-muted", bg: "bg-muted/10", text: "text-muted-foreground" };
    case "REJECTED":
    default:
      return { label, icon: <XCircle className="h-4 w-4 shrink-0" />, border: "border-muted", bg: "bg-muted/10", text: "text-muted-foreground" };
  }
}

// ---------------------------------------------------------------------------
// Warning categorization
// ---------------------------------------------------------------------------

type WarningCategory = "earnings" | "liquidity" | "options" | "regime" | "general";

function categorizeWarning(w: string): WarningCategory {
  if (/earnings|ER\b/i.test(w)) return "earnings";
  if (/liquid|thin market|low volume|spread/i.test(w)) return "liquidity";
  if (/option|chain|implied vol|IV\b/i.test(w)) return "options";
  if (/regime|bear market|macro|market condition/i.test(w)) return "regime";
  return "general";
}

const WARNING_ICON: Record<WarningCategory, React.ReactNode> = {
  earnings:  <AlertTriangle className="h-3 w-3 shrink-0 text-red-400" />,
  liquidity: <BarChart2 className="h-3 w-3 shrink-0 text-amber-400" />,
  options:   <TrendingUp className="h-3 w-3 shrink-0 text-sky-400" />,
  regime:    <AlertTriangle className="h-3 w-3 shrink-0 text-orange-400" />,
  general:   <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />,
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold">
      {children}
    </div>
  );
}

function MetricCell({
  label,
  value,
  sub,
  testId,
  valueClass,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  testId?: string;
  valueClass?: string;
}) {
  return (
    <div className="min-w-0 space-y-0.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{label}</div>
      <div className={`text-sm font-medium truncate ${valueClass ?? ""}`} data-testid={testId}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground/60">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// InstitutionalTradeCard (exported)
// ---------------------------------------------------------------------------

interface InstitutionalTradeCardProps {
  vm: TradePlanViewModel;
}

export function InstitutionalTradeCard({ vm }: InstitutionalTradeCardProps) {
  const borderClass    = CARD_BORDER[vm.verdict] ?? "border-border";
  // Sprint 4.1C — unified status: never generic "No Trade"
  const activeStatus   = vm.tradeStatus ?? computeTradeStatus(vm);
  const statusBadge    = tradeStatusBadgeClass(activeStatus);
  const statusLbl      = tradeStatusLabel(vm);
  const instrumentLbl  = INSTRUMENT_LABELS[vm.verdict] ?? "";
  const decisionCfg    = statusDecisionConfig(activeStatus, vm);
  const triggerLabel   = TRIGGER_STATE_LABEL[vm.triggerState] ?? vm.triggerState;
  const triggerClass   = TRIGGER_STATE_CLASS[vm.triggerState] ?? "";
  const hasTrigger     = vm.triggerState !== "NO_TRIGGER";
  // A setup is "positive" (green Why-selected bullets) when it's fully or partially qualified.
  const isPositive     = activeStatus === "TRADE_READY" || activeStatus === "TRIGGERED" ||
    (activeStatus === "AWAITING_BREAKOUT" && (vm.verdict === "STOCK" || vm.verdict === "LIVE_OPTIONS" || vm.verdict === "ESTIMATED_OPTIONS"));
  const isWatchOrNo    = !isPositive;
  const ctas           = tradePlanCtas(vm);

  // Distance-to-trigger display: distinguish "Already triggered" vs "+$X.XX (Y%)"
  let distanceLabel: string | undefined;
  if (vm.distanceToTrigger) {
    if (vm.triggerState === "TRIGGERED") {
      distanceLabel = "Already triggered";
    } else {
      // Strip the long suffix "(+2.1% to trigger)" for brevity in the grid cell
      // but keep the dollar value visible; the full string goes into the sub slot.
      distanceLabel = vm.distanceToTrigger;
    }
  }

  // Confluence signal count for the Supporting Evidence headline
  const confluenceCount = vm.reasons.length;

  return (
    <article
      className={`rounded-xl border p-4 space-y-4 ${borderClass}`}
      data-testid={`card-institutional-${vm.symbol}`}
      aria-label={`Trade plan for ${vm.symbol}: ${statusLbl}`}
      role="article"
    >
      {/* ── §1 HEADER ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2" data-testid={`header-institutional-${vm.symbol}`}>
        {vm.rank != null && (
          <Badge
            variant="outline"
            className="border-sky-500/40 text-sky-300 bg-sky-500/10 font-mono"
            data-testid={`badge-inst-rank-${vm.symbol}`}
            aria-label={`Ranked number ${vm.rank}`}
          >
            #{vm.rank}
          </Badge>
        )}
        <span
          className="font-bold text-lg tracking-tight"
          data-testid={`text-inst-symbol-${vm.symbol}`}
        >
          {vm.symbol}
        </span>
        {vm.direction && (
          <Badge
            variant="outline"
            className="border-indigo-500/40 text-indigo-300 bg-indigo-500/10"
            data-testid={`badge-inst-direction-${vm.symbol}`}
          >
            {vm.direction}
          </Badge>
        )}
        {/* Primary status badge — unified TradeCardStatus, never generic "No Trade" */}
        <Badge
          variant="outline"
          className={statusBadge}
          data-testid={`badge-inst-status-${vm.symbol}`}
          aria-label={`Status: ${statusLbl}`}
        >
          {statusLbl}
        </Badge>
        {/* Secondary instrument-type badge for options variants or unsupported */}
        {instrumentLbl && (
          <Badge
            variant="outline"
            className="border-muted-foreground/30 text-muted-foreground/80 bg-muted/10 text-[10px]"
            data-testid={`badge-inst-verdict-${vm.symbol}`}
          >
            {instrumentLbl}
          </Badge>
        )}
        {vm.confidence && (
          <Badge
            variant="outline"
            className="border-muted-foreground/30 text-muted-foreground"
            data-testid={`badge-inst-confidence-${vm.symbol}`}
          >
            {vm.confidence} confidence
          </Badge>
        )}
        {vm.simulatedData && (
          <Badge
            variant="outline"
            className="text-[10px] text-purple-300 border-purple-500/40 bg-purple-500/10"
            data-testid={`badge-inst-simulated-${vm.symbol}`}
          >
            Simulated Data
          </Badge>
        )}
        {vm.verdict === "ESTIMATED_OPTIONS" && (
          <Badge variant="outline" className="text-[10px] text-amber-300 border-amber-500/40 bg-amber-500/10">
            Estimates — no live chain
          </Badge>
        )}
      </div>

      {/* ── §2 TRADE PLAN ─────────────────────────────────────── */}
      <div
        className="rounded-lg border border-border/40 bg-background/40 p-3 space-y-3"
        data-testid={`section-inst-trade-plan-${vm.symbol}`}
        aria-label="Trade plan"
      >
        <SectionLabel>Trade Plan</SectionLabel>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
          {/* Current price */}
          {vm.currentPrice != null && (
            <MetricCell
              label="Current Price"
              value={`$${vm.currentPrice.toFixed(2)}`}
              testId={`field-inst-price-${vm.symbol}`}
            />
          )}

          {/* Entry trigger with state annotation */}
          {hasTrigger ? (
            <div className="min-w-0 space-y-0.5 col-span-1 sm:col-span-1">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Entry Trigger</div>
              <div
                className="text-sm font-medium truncate"
                data-testid={`field-inst-trigger-${vm.symbol}`}
              >
                {vm.trigger}
              </div>
              <div
                className={`text-[10px] font-medium ${triggerClass}`}
                data-testid={`badge-inst-trigger-state-${vm.symbol}`}
                aria-label={`Trigger state: ${triggerLabel}`}
              >
                {triggerLabel}
              </div>
            </div>
          ) : (
            <MetricCell
              label="Entry Trigger"
              value={<span className="text-muted-foreground/60 italic">No trigger set</span>}
              testId={`field-inst-trigger-${vm.symbol}`}
            />
          )}

          {/* Distance to trigger */}
          {distanceLabel && (
            <MetricCell
              label="Distance to Trigger"
              value={vm.triggerState === "TRIGGERED" ? "Already triggered" : distanceLabel}
              testId={`field-inst-distance-${vm.symbol}`}
              valueClass={vm.triggerState === "TRIGGERED" ? "text-emerald-400" : "text-sky-300"}
            />
          )}

          {/* Target (objective) */}
          {(vm.targetPrice != null || vm.objective) && (
            <MetricCell
              label="Target"
              value={vm.targetPrice != null ? `$${vm.targetPrice.toFixed(2)}` : (vm.objective ?? "")}
              sub={vm.targetPrice != null && vm.objective && vm.objective !== `$${vm.targetPrice.toFixed(2)}` ? vm.objective : undefined}
              testId={`field-inst-target-${vm.symbol}`}
              valueClass="text-emerald-300/90"
            />
          )}

          {/* Stop (invalidation) */}
          {(vm.stopPrice != null || vm.invalidation) && (
            <MetricCell
              label="Stop"
              value={vm.stopPrice != null ? `$${vm.stopPrice.toFixed(2)}` : (vm.invalidation ?? "")}
              sub={vm.stopPrice != null && vm.invalidation && vm.invalidation !== `$${vm.stopPrice.toFixed(2)}` ? vm.invalidation : undefined}
              testId={`field-inst-stop-${vm.symbol}`}
              valueClass="text-rose-300/90"
            />
          )}

          {/* Risk / Reward */}
          {vm.rewardRisk != null && (
            <MetricCell
              label="Risk / Reward"
              value={`${vm.rewardRisk.toFixed(1)}:1`}
              testId={`field-inst-rr-${vm.symbol}`}
            />
          )}

          {/* Expected hold */}
          {vm.expectedHold && (
            <MetricCell
              label="Expected Hold"
              value={vm.expectedHold}
              testId={`field-inst-hold-${vm.symbol}`}
            />
          )}
        </div>
      </div>

      {/* ── §3 SUPPORTING EVIDENCE ────────────────────────────── */}
      {(vm.strategy || vm.instrument || vm.dataQuality || vm.strategyScore != null || confluenceCount > 0 || vm.status) && (
        <div
          className="rounded-lg border border-border/40 bg-background/40 p-3 space-y-2.5"
          data-testid={`section-inst-evidence-${vm.symbol}`}
          aria-label="Supporting evidence"
        >
          <SectionLabel>Supporting Evidence</SectionLabel>

          {/* Meta row: strategy, instrument, score, data */}
          <div className="flex flex-wrap items-center gap-2">
            {vm.strategy && (
              <Badge
                variant="outline"
                className="border-sky-500/30 text-sky-300 bg-sky-500/8 text-[10px]"
                data-testid={`badge-inst-strategy-${vm.symbol}`}
              >
                {vm.strategy}
              </Badge>
            )}
            {vm.instrument && (
              <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground text-[10px]">
                {vm.instrument}
              </Badge>
            )}
            {vm.strategyScore != null && (
              <Badge
                variant="outline"
                className="border-muted-foreground/30 text-muted-foreground text-[10px]"
                data-testid={`badge-inst-score-${vm.symbol}`}
              >
                Score {vm.strategyScore}
              </Badge>
            )}
            {vm.dataQuality && (
              <Badge
                variant="outline"
                className="border-purple-500/30 text-purple-300 bg-purple-500/8 text-[10px]"
                data-testid={`badge-inst-data-quality-${vm.symbol}`}
              >
                {vm.dataQuality}
              </Badge>
            )}
            {vm.status && (
              <span className="text-[10px] text-muted-foreground" data-testid={`text-inst-status-${vm.symbol}`}>
                {vm.status}
              </span>
            )}
          </div>

          {/* Confluence signals */}
          {confluenceCount > 0 && (
            <div className="space-y-1" data-testid={`list-inst-confluence-${vm.symbol}`}>
              <div className="text-[10px] text-muted-foreground/60 font-medium">
                Confluence — {confluenceCount} signal{confluenceCount !== 1 ? "s" : ""}
              </div>
              <ul className="space-y-0.5">
                {vm.reasons.slice(0, 5).map((r, i) => (
                  <li
                    key={i}
                    className="text-xs text-muted-foreground/90 flex items-start gap-1.5"
                    data-testid={`text-inst-signal-${vm.symbol}-${i}`}
                  >
                    <span className="text-emerald-500/60 mt-0.5 shrink-0">▸</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Watch conditions as evidence context */}
          {vm.verdict === "WATCH" && vm.watchConditions && vm.watchConditions.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] text-muted-foreground/60 font-medium">Missing confirmation</div>
              <ul className="space-y-0.5">
                {vm.watchConditions.map((c, i) => (
                  <li key={i} className="text-xs text-amber-200/80 flex items-start gap-1.5">
                    <Clock className="h-3 w-3 shrink-0 mt-0.5 text-amber-400/60" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── §4 RISK ───────────────────────────────────────────── */}
      {(vm.maxRisk != null || vm.suggestedQuantity != null) && (
        <div
          className="rounded-lg border border-border/40 bg-background/40 p-3 space-y-2"
          data-testid={`section-inst-risk-${vm.symbol}`}
          aria-label="Risk details"
        >
          <SectionLabel>Risk</SectionLabel>
          <div className="flex flex-wrap gap-4 text-xs">
            {vm.maxRisk != null && (
              <div data-testid={`field-inst-max-risk-${vm.symbol}`}>
                <span className="text-muted-foreground">Max risk: </span>
                <span className={vm.maxRiskIsExact ? "font-medium" : "text-amber-300/90 font-medium"}>
                  {vm.maxRiskIsExact ? "" : "~"}${vm.maxRisk.toLocaleString()}
                </span>
                {!vm.maxRiskIsExact && (
                  <span className="text-muted-foreground text-[9px] ml-1">(est.)</span>
                )}
              </div>
            )}
            {vm.suggestedQuantity != null && (
              <div data-testid={`field-inst-quantity-${vm.symbol}`}>
                <span className="text-muted-foreground">Qty: </span>
                <span className="font-medium">{vm.suggestedQuantity}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── §5 DECISION ───────────────────────────────────────── */}
      <div
        className={`rounded-lg border ${decisionCfg.border} ${decisionCfg.bg} px-3 py-2 flex items-center gap-2`}
        data-testid={`section-inst-decision-${vm.symbol}`}
        aria-label={`Decision: ${decisionCfg.label}`}
      >
        <span className={decisionCfg.text}>{decisionCfg.icon}</span>
        <span className={`text-sm font-semibold ${decisionCfg.text}`} data-testid={`text-inst-decision-${vm.symbol}`}>
          {decisionCfg.label}
        </span>
      </div>

      {/* ── §6 WHY ────────────────────────────────────────────── */}
      {(isPositive && vm.reasons.length > 0) && (
        <div className="space-y-1" data-testid={`section-inst-why-selected-${vm.symbol}`} aria-label="Why selected">
          <SectionLabel>Why Selected</SectionLabel>
          <ul className="space-y-0.5">
            {vm.reasons.map((r, i) => (
              <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <CheckCircle2 className="h-3 w-3 shrink-0 mt-0.5 text-emerald-500/60" />
                <span data-testid={`text-inst-reason-${vm.symbol}-${i}`}>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isWatchOrNo && vm.reasons.length > 0 && (
        <div className="space-y-1" data-testid={`section-inst-why-rejected-${vm.symbol}`} aria-label="Why not actionable">
          <SectionLabel>Why {decision === "watch" ? "Not Yet Actionable" : "Rejected"}</SectionLabel>
          <ul className="space-y-0.5">
            {vm.reasons.map((r, i) => (
              <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <XCircle className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground/40" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(vm.watchConditions ?? []).length > 0 && decision !== "watch" && (
        <div className="space-y-1" data-testid={`section-inst-conditions-${vm.symbol}`} aria-label="What changes the verdict">
          <SectionLabel>What Changes the Verdict</SectionLabel>
          <ul className="space-y-0.5">
            {vm.watchConditions!.map((c, i) => (
              <li key={i} className="text-xs text-amber-200/80 flex items-start gap-1.5">
                <Clock className="h-3 w-3 shrink-0 mt-0.5 text-amber-400/60" />
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── §7 WARNINGS ───────────────────────────────────────── */}
      {(vm.warnings.length > 0 || vm.earningsRisk) && (
        <div
          className="space-y-1.5"
          data-testid={`section-inst-warnings-${vm.symbol}`}
          aria-label="Warnings"
          role="list"
        >
          <SectionLabel>Warnings</SectionLabel>
          <ul className="space-y-1">
            {vm.earningsRisk && !vm.warnings.some((w) => /earnings/i.test(w)) && (
              <li className="flex items-start gap-1.5 text-xs text-red-300/90" role="listitem">
                {WARNING_ICON.earnings}
                <span>Earnings event — options pricing may be elevated</span>
              </li>
            )}
            {vm.warnings.map((w, i) => {
              const cat = categorizeWarning(w);
              return (
                <li
                  key={i}
                  className="flex items-start gap-1.5 text-xs text-amber-300/90"
                  role="listitem"
                  data-testid={`text-inst-warning-${vm.symbol}-${i}`}
                >
                  {WARNING_ICON[cat]}
                  <span>{w}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── §8 CTAs ───────────────────────────────────────────── */}
      {ctas.length > 0 && (
        <div
          className="flex flex-wrap gap-2 pt-1"
          data-testid={`ctas-inst-${vm.symbol}`}
          role="group"
          aria-label="Trade actions"
        >
          {ctas.map((cta) => (
            <Button
              key={cta.label}
              asChild
              size="sm"
              variant={cta.primary ? "default" : "outline"}
              className="h-7 text-xs"
            >
              <Link href={cta.href}>{cta.label}</Link>
            </Button>
          ))}
        </div>
      )}
    </article>
  );
}
