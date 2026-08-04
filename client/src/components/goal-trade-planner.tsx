// Sprint 4.3 — Goal-Based Trade Planner display component.
//
// Wraps RankedTradeSearchCards with goal context sections:
//   §A  GOAL — parsed intent, constraints, risk budget
//   §B  QUALIFIED TRADES — delegates to RankedTradeSearchCards
//   §C  PORTFOLIO IMPACT — portfolioFitRows (Sprint 4.2)
//   §D  RISK SUMMARY — budget, allocation, mandatory disclaimer
//   §E  WHY OTHERS FAILED — rejection + exclusion summary (collapsed)
//
// Why-Selected lives inside each InstitutionalTradeCard (§6 WHY) —
// not duplicated here.
//
// Design rules:
//   • Never fabricate opportunities — only display what the server returned.
//   • Never guarantee profits — TRADE_GOAL_DISCLAIMER always shown.
//   • Show "Unknown" / "Not specified" honestly — no invented defaults.
//   • No account IDs, no broker tokens, no raw balances.

import { AlertTriangle, ChevronDown, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RankedTradeSearchCards } from "@/components/ranked-trade-search-cards";
import { portfolioFitRows, portfolioFitState } from "@/lib/portfolio-fit-display";
import {
  parseTradeGoalInput,
  STRATEGY_LABEL,
  OBJECTIVE_LABEL,
  TRADE_GOAL_DISCLAIMER,
  type TradeGoalIntent,
} from "@/lib/trade-goal-parser";
import type { RankedTradeSearch } from "@/lib/ranked-trade-search";
import type { SafePortfolioAwareness } from "@/lib/portfolio-awareness";
import { Badge as BadgeComponent } from "@/components/ui/badge";
import {
  actionableHint,
  dataRejectionGroups,
  shortExclusionLabel,
  trueRejectionGroups,
  translateRejectionReason,
} from "@/lib/ranked-trade-search";

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

// ---------------------------------------------------------------------------
// §A GOAL section
// ---------------------------------------------------------------------------

function GoalSection({ intent }: { intent: TradeGoalIntent }) {
  // Warnings minus the always-on disclaimer (shown separately in §D RISK)
  const advisoryWarnings = intent.warnings.filter(
    (w) => w !== TRADE_GOAL_DISCLAIMER,
  );

  return (
    <div
      className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 space-y-2.5"
      data-testid="section-goal-banner"
      aria-label="Trade goal"
    >
      <div className="flex items-start gap-2">
        <Target className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />
        <div className="space-y-1 min-w-0">
          <div
            className="text-sm font-semibold text-sky-200 leading-snug"
            data-testid="text-goal-summary"
          >
            {intent.summary}
          </div>
          {intent.rawGoal !== intent.summary && (
            <div
              className="text-[11px] text-muted-foreground/70 italic truncate"
              data-testid="text-goal-raw"
            >
              "{intent.rawGoal}"
            </div>
          )}
        </div>
      </div>

      {intent.constraintPhrases.length > 0 && (
        <div
          className="flex flex-wrap gap-1.5"
          data-testid="list-goal-constraints"
          aria-label="Goal constraints"
        >
          {intent.constraintPhrases.map((phrase) => (
            <Badge
              key={phrase}
              variant="outline"
              className="text-[10px] border-sky-500/40 text-sky-300 bg-sky-500/8"
              data-testid={`badge-goal-constraint`}
            >
              {phrase}
            </Badge>
          ))}
        </div>
      )}

      {advisoryWarnings.length > 0 && (
        <div className="space-y-1" data-testid="list-goal-warnings">
          {advisoryWarnings.map((w, i) => (
            <div
              key={i}
              className="flex items-start gap-1.5 text-[11px] text-amber-200/80"
              data-testid={`text-goal-warning-${i}`}
            >
              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5 text-amber-400/70" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// §C PORTFOLIO IMPACT section
// ---------------------------------------------------------------------------

function PortfolioImpactSection({
  awareness,
  suggestedQuantity,
}: {
  awareness: SafePortfolioAwareness | null | undefined;
  suggestedQuantity?: number;
}) {
  const state = portfolioFitState(awareness, suggestedQuantity);
  if (state === "hidden") return null;

  return (
    <div
      className="rounded-lg border border-border/40 bg-background/40 p-3 space-y-2.5"
      data-testid="section-goal-portfolio-impact"
      aria-label="Portfolio impact"
    >
      <SectionLabel>Portfolio Impact</SectionLabel>

      {state === "disconnected" && (
        <p
          className="text-xs text-muted-foreground/70"
          data-testid="text-goal-portfolio-disconnected"
        >
          No brokerage connected — connect a broker to see concentration checks,
          buying power, and position sizing for these trades.
        </p>
      )}

      {state === "no-position" && (
        <p className="text-xs text-muted-foreground/70" data-testid="text-goal-portfolio-no-position">
          Broker connected. No existing positions overlap with these candidates.
        </p>
      )}

      {state === "show" && (() => {
        const rows = portfolioFitRows(awareness!, suggestedQuantity);
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
            {rows.map((row) => (
              <div key={row.testId} data-testid={row.testId}>
                <span className="text-muted-foreground">{row.label}: </span>
                {row.badgeClass ? (
                  <span>
                    <span className={`font-medium ${row.valueClass}`}>{row.value}</span>
                    {" "}
                    <BadgeComponent
                      variant="outline"
                      className={`text-[9px] py-0 ${row.badgeClass}`}
                    >
                      {awareness?.concentrationWarning?.level}
                    </BadgeComponent>
                  </span>
                ) : (
                  <span className={`font-medium ${row.valueClass}`}>{row.value}</span>
                )}
              </div>
            ))}
          </div>
        );
      })()}

      {awareness?.contextFreshness && (
        <div className="text-[9px] text-muted-foreground/40 border-t border-border/20 pt-1.5">
          Portfolio context read-only · refreshed{" "}
          {new Date(awareness.contextFreshness).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          · No account numbers shown
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// §D RISK SUMMARY section
// ---------------------------------------------------------------------------

function RiskSummarySection({
  intent,
  search,
}: {
  intent: TradeGoalIntent;
  search: RankedTradeSearch;
}) {
  const hasBudget = intent.maxRiskDollars != null || intent.maxRiskPercent != null;
  const serverMaxRisk = search.maxRiskDollars;

  return (
    <div
      className="rounded-lg border border-border/40 bg-background/40 p-3 space-y-2"
      data-testid="section-goal-risk"
      aria-label="Risk summary"
    >
      <SectionLabel>Risk</SectionLabel>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
        {/* Goal risk budget */}
        {intent.maxRiskDollars != null && (
          <div data-testid="row-goal-risk-dollars">
            <span className="text-muted-foreground">Goal risk limit: </span>
            <span className="font-medium">${intent.maxRiskDollars.toLocaleString()} per trade</span>
          </div>
        )}
        {intent.maxRiskPercent != null && (
          <div data-testid="row-goal-risk-percent">
            <span className="text-muted-foreground">Portfolio allocation limit: </span>
            <span className="font-medium">{intent.maxRiskPercent}% per trade</span>
          </div>
        )}
        {/* Server-confirmed risk ceiling from ranked search */}
        {serverMaxRisk != null && (
          <div data-testid="row-goal-risk-server">
            <span className="text-muted-foreground">Applied risk ceiling: </span>
            <span className="font-medium">${serverMaxRisk.toLocaleString()}</span>
          </div>
        )}
        {!hasBudget && serverMaxRisk == null && (
          <div className="col-span-full text-muted-foreground/70 italic">
            No risk budget specified — no upper limit was applied to this search.
          </div>
        )}
      </div>

      {/* Mandatory no-profit disclaimer — never omit */}
      <div
        className="flex items-start gap-1.5 text-[10px] text-amber-200/60 border-t border-border/30 pt-2"
        data-testid="text-goal-disclaimer"
        role="note"
        aria-label="Risk disclaimer"
      >
        <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5 text-amber-400/50" />
        <span>{TRADE_GOAL_DISCLAIMER}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §E WHY OTHERS FAILED section (collapsed)
// ---------------------------------------------------------------------------

function WhyOthersFailedSection({ search }: { search: RankedTradeSearch }) {
  // §3 (Sprint 4.4): only true qualification failures appear under "Rejected".
  // Data-unavailability groups (DATA_UNAVAILABLE, OPTIONS_DATA_UNAVAILABLE,
  // MARKET_REGIME_UNAVAILABLE, etc.) are stripped — they are not quality failures.
  const trueRejections = trueRejectionGroups(search.rejectionSummary);
  const trueRejectedCount = trueRejections.reduce((s, g) => s + g.count, 0);
  const hasRejections = trueRejections.length > 0 || trueRejectedCount > 0;

  // §36 (Sprint 4.4 follow-up): Unavailable Candidates — separate from Rejected.
  // Includes unavailableCount + any data-unavailability rejection groups.
  const unavailableExtraGroups = dataRejectionGroups(search.rejectionSummary);
  const totalUnavailable =
    search.unavailableCount + unavailableExtraGroups.reduce((s, g) => s + g.count, 0);
  const hasUnavailable = totalUnavailable > 0 || unavailableExtraGroups.length > 0;

  const hasExclusions = (search.excludedCount ?? 0) > 0;

  if (!hasRejections && !hasExclusions && !hasUnavailable) return null;

  return (
    <div
      className="space-y-2"
      data-testid="section-goal-why-failed"
      aria-label="Why other setups were not selected"
    >
      {/* Post-confluence rejections — true qualification failures only */}
      {hasRejections && (
        <details
          className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3"
          data-testid="details-goal-rejections"
        >
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 list-none">
            <ChevronDown className="h-3.5 w-3.5" />
            Why setups were rejected ({trueRejectedCount})
          </summary>
          <div className="mt-2 space-y-2.5">
            <p className="text-[11px] text-muted-foreground/80">
              These setups reached the qualification stage but were rejected
              because they didn't meet all required conditions.
            </p>
            {trueRejections.length === 0 && (
              <div className="text-xs text-muted-foreground">
                {trueRejectedCount}{" "}
                {trueRejectedCount === 1 ? "setup was" : "setups were"} rejected.
              </div>
            )}
            {trueRejections.map((g) => {
              const label = translateRejectionReason(g.reason);
              const hint  = actionableHint(g.reason);
              return (
                <div
                  key={g.reason}
                  className="text-xs space-y-0.5 pb-2 border-b border-rose-500/10 last:border-0 last:pb-0"
                  data-testid={`row-goal-rejection-${g.reason}`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-rose-300/90 font-medium">{label}</span>
                    <span className="text-muted-foreground">— {g.count}</span>
                    {g.symbols.length > 0 && (
                      <span className="text-muted-foreground/70">
                        ({g.symbols.slice(0, 5).join(", ")}{g.symbols.length > 5 ? "…" : ""})
                      </span>
                    )}
                  </div>
                  {hint && (
                    <div className="text-muted-foreground/80 pl-0.5">
                      <span className="text-muted-foreground/50 uppercase text-[10px] tracking-wide mr-1">
                        What would qualify:
                      </span>
                      {hint}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      )}

      {/* Pre-confluence exclusions — count-first format (Task #37) */}
      {hasExclusions && (
        <details
          className="rounded-lg border border-muted/40 bg-muted/10 p-3"
          data-testid="details-goal-exclusions"
        >
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 list-none">
            <ChevronDown className="h-3.5 w-3.5" />
            Filtered before qualification ({search.excludedCount})
          </summary>
          <div className="mt-2 space-y-1.5">
            <p className="text-[11px] text-muted-foreground/80">
              These opportunities were removed before the qualification stage —
              not because of poor quality, but because they didn't match the
              goal's basic filters (strategy type, direction, risk limit).
            </p>
            {(search.exclusionSummary ?? []).length === 0 ? (
              <div className="text-xs text-muted-foreground">
                {search.excludedCount}{" "}
                {search.excludedCount === 1 ? "opportunity was" : "opportunities were"} filtered
                before qualification.
              </div>
            ) : (
              (search.exclusionSummary ?? []).map((g) => (
                <div
                  key={g.reason}
                  className="text-xs flex items-center gap-2"
                  data-testid={`row-goal-exclusion-${g.reason}`}
                >
                  <span className="tabular-nums font-semibold text-foreground/70 w-6 text-right shrink-0">
                    {g.count}
                  </span>
                  <span className="text-muted-foreground">{shortExclusionLabel(g.reason)}</span>
                </div>
              ))
            )}
          </div>
        </details>
      )}

      {/* Unavailable Candidates — data could not be retrieved (Task #36) */}
      {hasUnavailable && (
        <div
          className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs space-y-1.5"
          data-testid="section-goal-unavailable"
        >
          <div className="font-medium uppercase tracking-wide text-muted-foreground text-[10px]">
            Unavailable Candidates
          </div>
          <div className="text-amber-100/90">
            {totalUnavailable}{" "}
            {totalUnavailable === 1 ? "candidate" : "candidates"} could not be evaluated because
            required market data was unavailable from the provider. The engine did not estimate
            or fabricate the missing information.
          </div>
          {unavailableExtraGroups.map((g) => (
            <div
              key={g.reason}
              className="text-amber-100/70"
              data-testid={`row-goal-unavailable-${g.reason}`}
            >
              {translateRejectionReason(g.reason)}
              {g.symbols.length > 0 && (
                <span className="text-amber-100/50 ml-1">
                  ({g.symbols.slice(0, 3).join(", ")}
                  {g.symbols.length > 3 ? "…" : ""})
                </span>
              )}
              <span className="text-amber-100/50 ml-1">— {g.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export — GoalTradePlanner
// ---------------------------------------------------------------------------

export interface GoalTradePlannerProps {
  search: RankedTradeSearch;
  /** Original question text — parsed into TradeGoalIntent for display. */
  question: string;
  /** SafePortfolioAwareness from the Ask AI response. */
  awareness?: SafePortfolioAwareness | null;
  /** Source string from the server (drives the fallback banner in ranked cards). */
  source?: string;
}

/**
 * Goal-Based Trade Planner.
 *
 * Wraps RankedTradeSearchCards with goal context sections.
 * Sections: Goal → Qualified Trades → Portfolio Impact → Risk → Why Others Failed.
 *
 * "Why Selected" is already rendered inside each InstitutionalTradeCard (§6 WHY).
 * This component only adds the overarching goal context layer.
 */
export function GoalTradePlanner({
  search,
  question,
  awareness,
  source,
}: GoalTradePlannerProps) {
  const intent = parseTradeGoalInput(question);
  // When qualifiedCount = 0, RankedTradeSearchCards already renders all the
  // detail sections (Why Nothing Qualified, Exclusions, Unavailable, Rejected).
  // Do not also render WhyOthersFailedSection — that would duplicate them.
  const hasQualified = search.qualifiedCount > 0 || search.candidates.length > 0;

  return (
    <div className="space-y-4" data-testid="section-goal-trade-planner">
      {/* §A GOAL */}
      <GoalSection intent={intent} />

      {/* §B QUALIFIED TRADES — heading hidden when zero qualify */}
      {hasQualified ? (
        <div data-testid="section-goal-qualified-trades">
          <SectionLabel>Qualified Trades</SectionLabel>
          <div className="mt-2">
            <RankedTradeSearchCards
              search={search}
              question={question}
              source={source}
            />
          </div>
        </div>
      ) : (
        // Zero-qualified: delegate entirely to RankedTradeSearchCards which
        // renders the ordered detail sections per §3.
        // No "Qualified Trades" heading — nothing qualifies.
        <div data-testid="section-goal-zero-qualified">
          <RankedTradeSearchCards
            search={search}
            question={question}
            source={source}
          />
        </div>
      )}

      {/* §C PORTFOLIO IMPACT */}
      <PortfolioImpactSection awareness={awareness} />

      {/* §D RISK SUMMARY */}
      <RiskSummarySection intent={intent} search={search} />

      {/* §E WHY OTHERS FAILED — only when qualified candidates exist.
          When zero qualified, RankedTradeSearchCards already shows all
          exclusion/unavailable/rejection detail. */}
      {hasQualified && <WhyOthersFailedSection search={search} />}
    </div>
  );
}
