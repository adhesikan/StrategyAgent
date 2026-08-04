// Sprint 4.3 — Goal-Based Trade Planner display component.
// Sprint 4.5 — Final UX polish:
//   §1  DeterministicEngineSummaryCard replaces generic empty state
//   §3  Single CTA group (Run Fresh Scan / Review Watchlist); no duplicates
//   §6  PortfolioImpactSection redesigned as 5-item PASS/NOT VERIFIED status grid
//   §8  Section ordering: Goal → DeterministicSummary → WhyNothing → Excluded
//       → Unavailable → Portfolio → Risk → Next Steps
//   §9  Terminology standardised (no "setups", "ideas")
//   §10 Status colours applied to portfolio checks
//
// Design rules (unchanged):
//   • Never fabricate opportunities — only display what the server returned.
//   • Never guarantee profits — TRADE_GOAL_DISCLAIMER always shown.
//   • Show "Unknown" / "Not specified" honestly — no invented defaults.
//   • No account IDs, no broker tokens, no raw balances.

import { AlertTriangle, ChevronDown, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DeterministicEngineSummaryCard,
  ExclusionSection,
  RankedTradeSearchCards,
  UnavailableCandidatesSection,
  WhyNothingQualifiedSection,
} from "@/components/ranked-trade-search-cards";
import { portfolioFitState } from "@/lib/portfolio-fit-display";
import {
  parseTradeGoalInput,
  STRATEGY_LABEL,
  OBJECTIVE_LABEL,
  TRADE_GOAL_DISCLAIMER,
  type TradeGoalIntent,
} from "@/lib/trade-goal-parser";
import {
  actionableHint,
  dataRejectionGroups,
  shortExclusionLabel,
  translateRejectionReason,
  trueRejectionGroups,
  zeroQualifiedCtas,
  type RankedTradeSearch,
} from "@/lib/ranked-trade-search";
import type { SafePortfolioAwareness } from "@/lib/portfolio-awareness";
import { Badge as BadgeComponent } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

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
  const advisoryWarnings = intent.warnings.filter((w) => w !== TRADE_GOAL_DISCLAIMER);

  return (
    <div
      className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 space-y-2.5"
      data-testid="section-goal-banner"
      aria-label="Trade goal"
    >
      <div className="flex items-start gap-2">
        <Target className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" aria-hidden="true" />
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
              data-testid="badge-goal-constraint"
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
              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5 text-amber-400/70" aria-hidden="true" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// §6 PORTFOLIO IMPACT — 5-item PASS / NOT VERIFIED / NOT EVALUATED status grid
// ---------------------------------------------------------------------------

type CheckStatus = "PASS" | "FAIL" | "NOT VERIFIED" | "NOT EVALUATED" | "ELEVATED" | "HIGH";

interface PortfolioCheck {
  label: string;
  status: CheckStatus;
  testId: string;
}

/**
 * Derives the 5 independent portfolio check statuses from SafePortfolioAwareness.
 * Every status is read from backend fields only — never invented (§2).
 * Buying power and cash verification are kept separate — never combined
 * into an "affordable" verdict (PORTFOLIO RULE).
 */
function portfolioChecks(awareness: SafePortfolioAwareness): PortfolioCheck[] {
  return [
    {
      label: "Buying Power",
      status:
        awareness.buyingPowerSufficiency === "sufficient" ? "PASS" :
        awareness.buyingPowerSufficiency === "insufficient" ? "FAIL" :
        "NOT VERIFIED",
      testId: "row-portfolio-buying-power",
    },
    {
      label: "Cash Verification",
      status:
        awareness.cashSufficiency === "verified" ? "PASS" :
        awareness.cashSufficiency === "insufficient" ? "FAIL" :
        "NOT VERIFIED",
      testId: "row-portfolio-cash",
    },
    {
      label: "Risk Budget",
      status: awareness.sizingAdjustment == null ? "PASS" : "NOT VERIFIED",
      testId: "row-portfolio-risk-budget",
    },
    {
      label: "Position Concentration",
      status:
        awareness.concentrationWarning == null ? "NOT EVALUATED" :
        awareness.concentrationWarning.level === "normal" ? "PASS" :
        awareness.concentrationWarning.level === "elevated" ? "ELEVATED" :
        "HIGH",
      testId: "row-portfolio-concentration",
    },
    {
      label: "Portfolio Policy",
      status:
        awareness.duplicateExposure == null ? "NOT EVALUATED" :
        awareness.duplicateExposure === false ? "PASS" :
        "FAIL",
      testId: "row-portfolio-policy",
    },
  ];
}

function statusBadgeClasses(status: CheckStatus): string {
  switch (status) {
    case "PASS":          return "border-emerald-500/40 text-emerald-400 bg-emerald-500/10";
    case "FAIL":          return "border-rose-500/40 text-rose-400 bg-rose-500/10";
    case "ELEVATED":      return "border-amber-500/40 text-amber-400 bg-amber-500/10";
    case "HIGH":          return "border-rose-500/50 text-rose-300 bg-rose-500/15";
    case "NOT VERIFIED":  return "border-border/40 text-muted-foreground bg-muted/20";
    case "NOT EVALUATED": return "border-border/30 text-muted-foreground/60 bg-muted/10";
  }
}

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
          No brokerage connected — connect a broker to see buying power, cash
          verification, and concentration checks.
        </p>
      )}

      {(state === "no-position" || state === "show") && awareness && (
        <div className="space-y-2" aria-label="Portfolio checks">
          {portfolioChecks(awareness).map((check) => (
            <div
              key={check.label}
              className="flex items-center justify-between text-xs"
              data-testid={check.testId}
            >
              <span className="text-muted-foreground">{check.label}</span>
              <BadgeComponent
                variant="outline"
                className={`text-[9px] font-semibold tracking-wide py-0 ${statusBadgeClasses(check.status)}`}
                aria-label={`${check.label}: ${check.status}`}
              >
                {check.status}
              </BadgeComponent>
            </div>
          ))}
        </div>
      )}

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

      {/* Mandatory no-profit disclaimer */}
      <div
        className="flex items-start gap-1.5 text-[10px] text-amber-200/60 border-t border-border/30 pt-2"
        data-testid="text-goal-disclaimer"
        role="note"
        aria-label="Risk disclaimer"
      >
        <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5 text-amber-400/50" aria-hidden="true" />
        <span>{TRADE_GOAL_DISCLAIMER}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §E WHY OTHERS FAILED — qualified-path only (collapsed)
// ---------------------------------------------------------------------------

function WhyOthersFailedSection({ search }: { search: RankedTradeSearch }) {
  const trueRejections = trueRejectionGroups(search.rejectionSummary);
  const trueRejectedCount = trueRejections.reduce((s, g) => s + g.count, 0);
  const hasRejections = trueRejectedCount > 0;

  const unavailableExtraGroups = dataRejectionGroups(search.rejectionSummary);
  const totalUnavailable =
    search.unavailableCount + unavailableExtraGroups.reduce((s, g) => s + g.count, 0);
  const hasUnavailable = totalUnavailable > 0;

  const hasExclusions = (search.excludedCount ?? 0) > 0;

  if (!hasRejections && !hasExclusions && !hasUnavailable) return null;

  return (
    <div
      className="space-y-2"
      data-testid="section-goal-why-failed"
      aria-label="Why other candidates were not selected"
    >
      {/* Rejected Candidates — true qualification failures only */}
      {hasRejections && (
        <details
          className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3"
          data-testid="details-goal-rejections"
        >
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 list-none">
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            Rejected Candidates ({trueRejectedCount})
          </summary>
          <div className="mt-2 space-y-2.5">
            <p className="text-[11px] text-muted-foreground/80">
              These candidates reached the qualification stage but were rejected
              because they didn't meet all required conditions.
            </p>
            {trueRejections.map((g) => {
              const label = translateRejectionReason(g.reason);
              const hint = actionableHint(g.reason);
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
                        To qualify:
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

      {/* Excluded Before Qualification — count-first format */}
      {hasExclusions && (
        <ExclusionSection
          groups={search.exclusionSummary ?? []}
          totalExcluded={search.excludedCount!}
        />
      )}

      {/* Unavailable Candidates */}
      {hasUnavailable && (
        <div
          className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs space-y-1.5"
          data-testid="section-goal-unavailable"
          aria-label="Unavailable candidates"
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
// §3 — Next Steps CTA section (single group, no duplicates)
// ---------------------------------------------------------------------------

function NextStepsSection({ question }: { question?: string }) {
  const ctas = zeroQualifiedCtas(question);
  return (
    <div
      className="rounded-lg border border-border/30 bg-background/30 p-3 space-y-2"
      data-testid="section-goal-next-steps"
      aria-label="Next steps"
    >
      <SectionLabel>Next Steps</SectionLabel>
      <div className="flex flex-wrap gap-2">
        {ctas.map((cta) => (
          <Button
            key={cta.label}
            asChild
            size="sm"
            variant={cta.primary ? "default" : "outline"}
            className="h-7 text-xs"
            aria-label={cta.label}
          >
            <Link href={cta.href}>{cta.label}</Link>
          </Button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export — GoalTradePlanner
// ---------------------------------------------------------------------------

export interface GoalTradePlannerProps {
  search: RankedTradeSearch;
  question: string;
  awareness?: SafePortfolioAwareness | null;
  source?: string;
}

/**
 * Goal-Based Trade Planner.
 *
 * Zero-qualified §8 order:
 *   1 Search Goal
 *   2 Deterministic Engine Summary
 *   3 Why Nothing Qualified
 *   4 Excluded Before Qualification
 *   5 Unavailable Candidates
 *   6 Portfolio Impact
 *   7 Risk Constraints
 *   8 Next Steps
 *
 * Qualified §B order:
 *   1 Search Goal
 *   2 Qualified Trades (→ RankedTradeSearchCards)
 *   3 Portfolio Impact
 *   4 Risk
 *   5 Why Others Failed
 *
 * WhyOthersFailedSection is ONLY rendered in the qualified path — when
 * zero candidates qualify, the detail sections (Exclusions, Unavailable,
 * Rejected) are already shown above Portfolio / Risk to avoid duplication.
 */
export function GoalTradePlanner({
  search,
  question,
  awareness,
  source,
}: GoalTradePlannerProps) {
  const intent = parseTradeGoalInput(question);
  const hasQualified = search.qualifiedCount > 0 || search.candidates.length > 0;

  // ---------------------------------------------------------------------------
  // Zero-qualified layout — spec §8 ordering
  // ---------------------------------------------------------------------------

  if (!hasQualified) {
    return (
      <div className="space-y-4" data-testid="section-goal-trade-planner">
        {/* §8.1 Search Goal */}
        <GoalSection intent={intent} />

        <div className="space-y-3" data-testid="section-goal-zero-qualified">
          {/* §8.2 Deterministic Engine Summary */}
          <DeterministicEngineSummaryCard search={search} />

          {/* §8.3 Why Nothing Qualified */}
          <WhyNothingQualifiedSection search={search} />

          {/* §8.4 Excluded Before Qualification */}
          {(search.excludedCount ?? 0) > 0 && (
            <ExclusionSection
              groups={search.exclusionSummary ?? []}
              totalExcluded={search.excludedCount!}
              hideCtas
            />
          )}

          {/* §8.5 Unavailable Candidates */}
          <UnavailableCandidatesSection search={search} hideCtas />
        </div>

        {/* §8.6 Portfolio Impact */}
        <PortfolioImpactSection awareness={awareness} />

        {/* §8.7 Risk Constraints */}
        <RiskSummarySection intent={intent} search={search} />

        {/* §8.8 Next Steps — single CTA group (§3 no duplicates) */}
        <NextStepsSection question={question} />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Qualified layout
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-4" data-testid="section-goal-trade-planner">
      {/* §A Search Goal */}
      <GoalSection intent={intent} />

      {/* §B Qualified Trades */}
      <div data-testid="section-goal-qualified-trades">
        <SectionLabel>Qualified Trades</SectionLabel>
        <div className="mt-2">
          <RankedTradeSearchCards search={search} question={question} source={source} />
        </div>
      </div>

      {/* §C Portfolio Impact */}
      <PortfolioImpactSection awareness={awareness} />

      {/* §D Risk */}
      <RiskSummarySection intent={intent} search={search} />

      {/* §E Why Others Failed */}
      <WhyOthersFailedSection search={search} />
    </div>
  );
}
