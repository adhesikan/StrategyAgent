// Portfolio-constrained trade plan — 9-section structured display.
// Sections: Goal, Feasibility, Portfolio Constraints, Qualified Candidates,
// Why Selected, Why Alternatives Failed, Portfolio Impact, Risk, Next Steps.
//
// The frontend never generates, reorders, or promotes candidates.
// The deterministic MCP verdict (feasibility.feasible, candidates, constraints)
// is always shown; the LLM narrative lives in the parent ask.tsx prose.

import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  HelpCircle,
  ArrowRight,
  TrendingUp,
  ShieldCheck,
  ListChecks,
  Target,
  PieChart,
  AlertCircle,
  Footprints,
} from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  PortfolioTradePlan,
  PortfolioTradePlanCandidate,
  PortfolioTradePlanConstraint,
  PortfolioTradePlanAlternative,
} from "@/lib/portfolio-trade-plan";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function SectionHeader({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon className="h-3.5 w-3.5 text-primary/70 shrink-0" />
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="text-xs">
      <span className="text-muted-foreground">{label}: </span>
      <span>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 1 — Goal
// ---------------------------------------------------------------------------

function goalDescription(plan: PortfolioTradePlan): string {
  const f = plan.feasibility;
  if (!f.feasible) return "Portfolio-constrained trade plan";
  const q = plan.qualifiedCandidates.length;
  if (q === 0) return "No candidates currently qualify";
  return `${q} candidate${q === 1 ? "" : "s"} evaluated`;
}

// ---------------------------------------------------------------------------
// Section 2 — Feasibility badge
// ---------------------------------------------------------------------------

function FeasibilitySection({ feasibility }: { feasibility: PortfolioTradePlan["feasibility"] }) {
  return (
    <div
      className={`rounded-lg border p-3 flex items-start gap-3 ${
        feasibility.feasible
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-rose-500/30 bg-rose-500/5"
      }`}
      data-testid="section-ptp-feasibility"
    >
      {feasibility.feasible ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
      ) : (
        <XCircle className="h-4 w-4 text-rose-400 mt-0.5 shrink-0" />
      )}
      <div>
        <Badge
          variant="outline"
          className={
            feasibility.feasible
              ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10 mb-1"
              : "border-rose-500/40 text-rose-300 bg-rose-500/10 mb-1"
          }
          data-testid="badge-ptp-feasibility"
        >
          {feasibility.feasible ? "Feasible" : "Not Feasible"}
        </Badge>
        {feasibility.reason && (
          <p className="text-xs text-muted-foreground">{feasibility.reason}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 3 — Portfolio Constraints
// ---------------------------------------------------------------------------

function constraintIcon(status: PortfolioTradePlanConstraint["status"]) {
  switch (status) {
    case "met":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />;
    case "partially_met":
      return <Clock className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />;
    case "not_met":
      return <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0 mt-0.5" />;
    default:
      return <HelpCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />;
  }
}

function constraintStatusLabel(status: PortfolioTradePlanConstraint["status"]): string {
  switch (status) {
    case "met":           return "Met";
    case "partially_met": return "Partially met";
    case "not_met":       return "Not met";
    default:              return "Unknown";
  }
}

function ConstraintsSection({ constraints }: { constraints: PortfolioTradePlanConstraint[] }) {
  if (constraints.length === 0) return null;
  return (
    <div data-testid="section-ptp-constraints">
      <SectionHeader icon={ShieldCheck} label="Portfolio Constraints" />
      <div className="space-y-2">
        {constraints.map((c, i) => (
          <div
            key={i}
            className="flex items-start gap-2 rounded-md border border-border/30 bg-card/40 p-2.5"
            data-testid={`ptp-constraint-${i}`}
          >
            {constraintIcon(c.status)}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                <span className="text-xs font-medium">{c.name}</span>
                <Badge
                  variant="outline"
                  className={`text-[10px] ${
                    c.status === "met"
                      ? "border-emerald-500/40 text-emerald-300"
                      : c.status === "not_met"
                        ? "border-rose-500/40 text-rose-300"
                        : c.status === "partially_met"
                          ? "border-amber-500/40 text-amber-300"
                          : "border-muted-foreground/30 text-muted-foreground"
                  }`}
                >
                  {constraintStatusLabel(c.status)}
                </Badge>
              </div>
              {c.detail && <p className="text-[11px] text-muted-foreground">{c.detail}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 4 — Qualified Candidates
// ---------------------------------------------------------------------------

function CandidateCard({ c }: { c: PortfolioTradePlanCandidate }) {
  return (
    <div
      className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.03] p-3 space-y-2"
      data-testid={`ptp-candidate-${c.symbol}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-sm">{c.symbol}</span>
        <Badge variant="secondary" className="text-[10px]">#{c.rank}</Badge>
        {c.strategy && <Badge variant="outline" className="text-[10px]">{c.strategy}</Badge>}
        {c.direction && (
          <Badge
            variant="outline"
            className={`text-[10px] capitalize ${
              c.direction === "bullish"
                ? "border-emerald-500/40 text-emerald-300"
                : c.direction === "bearish"
                  ? "border-rose-500/40 text-rose-300"
                  : "border-muted-foreground/30 text-muted-foreground"
            }`}
          >
            {c.direction}
          </Badge>
        )}
        {c.instrument && <Badge variant="outline" className="text-[10px] text-muted-foreground">{c.instrument}</Badge>}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        {c.entryPrice != null && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Entry</div>
            <div className="font-mono">${c.entryPrice.toFixed(2)}</div>
          </div>
        )}
        {c.stopPrice != null && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Stop</div>
            <div className="font-mono text-rose-300">${c.stopPrice.toFixed(2)}</div>
          </div>
        )}
        {c.targetPrice != null && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Target</div>
            <div className="font-mono text-emerald-300">${c.targetPrice.toFixed(2)}</div>
          </div>
        )}
        {c.maxRiskDollars != null && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {c.maxRiskIsExact ? "Max risk" : "Est. max risk"}
            </div>
            <div className="font-mono">${c.maxRiskDollars.toLocaleString("en-US")}</div>
            {!c.maxRiskIsExact && (
              <div className="text-[9px] text-amber-400/80">Not an exact figure</div>
            )}
          </div>
        )}
        {c.rewardRisk != null && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">R/R</div>
            <div className="font-mono">{c.rewardRisk.toFixed(2)}:1</div>
          </div>
        )}
        {c.quantity != null && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Qty</div>
            <div className="font-mono">{c.quantity}</div>
          </div>
        )}
      </div>

      {c.warnings.length > 0 && (
        <div className="space-y-1">
          {c.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] text-amber-100/90">
              <AlertTriangle className="h-3 w-3 text-amber-400 mt-0.5 shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 pt-0.5">
        <Button asChild size="sm" variant="outline" className="h-6 text-[11px] gap-1">
          <Link href={`/ask?q=${encodeURIComponent(`Analyze ${c.symbol}`)}`}>
            Analyze <ArrowRight className="h-2.5 w-2.5" />
          </Link>
        </Button>
        <Button asChild size="sm" variant="ghost" className="h-6 text-[11px]">
          <Link href={`/market-intel?symbol=${c.symbol}`}>Intel</Link>
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 5 — Why Selected
// ---------------------------------------------------------------------------

function WhySelectedSection({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;
  return (
    <div data-testid="section-ptp-why-selected">
      <SectionHeader icon={ListChecks} label="Why Selected" />
      <ul className="space-y-1">
        {reasons.map((r, i) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 6 — Why Alternatives Failed
// ---------------------------------------------------------------------------

function AlternativesSection({ alternatives }: { alternatives: PortfolioTradePlanAlternative[] }) {
  if (alternatives.length === 0) return null;
  return (
    <details className="rounded-lg border border-muted/40 bg-muted/10 p-3" data-testid="section-ptp-alternatives">
      <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 list-none">
        <AlertCircle className="h-3.5 w-3.5" />
        Why Alternatives Failed ({alternatives.length})
      </summary>
      <ul className="mt-2 space-y-2">
        {alternatives.map((a, i) => (
          <li key={i} className="text-xs" data-testid={`ptp-alternative-${i}`}>
            {(a.symbol || a.strategy) && (
              <span className="font-medium">
                {a.symbol ?? ""}{a.symbol && a.strategy ? " " : ""}{a.strategy ? `(${a.strategy})` : ""}{" "}
              </span>
            )}
            <span className="text-muted-foreground">{a.whyFailed}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Section 7 — Portfolio Impact
// ---------------------------------------------------------------------------

function ImpactSection({ impact }: { impact: PortfolioTradePlan["portfolioImpact"] }) {
  if (!impact) return null;
  const { concentrationEffect, capitalEffect, diversificationNote } = impact;
  if (!concentrationEffect && !capitalEffect && !diversificationNote) return null;
  return (
    <div data-testid="section-ptp-impact">
      <SectionHeader icon={PieChart} label="Portfolio Impact" />
      <div className="space-y-1.5">
        <Field label="Concentration" value={concentrationEffect} />
        <Field label="Capital" value={capitalEffect} />
        <Field label="Diversification" value={diversificationNote} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 8 — Risk
// ---------------------------------------------------------------------------

function RiskSection({ risks }: { risks: PortfolioTradePlan["risks"] }) {
  if (!risks) return null;
  const { primaryRisk, otherRisks } = risks;
  if (!primaryRisk && (!otherRisks || otherRisks.length === 0)) return null;
  return (
    <div
      className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"
      data-testid="section-ptp-risks"
    >
      <SectionHeader icon={AlertTriangle} label="Risk" />
      {primaryRisk && (
        <p className="text-xs text-amber-100/90 mb-1.5">{primaryRisk}</p>
      )}
      {otherRisks && otherRisks.length > 0 && (
        <ul className="space-y-1">
          {otherRisks.map((r, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] text-amber-100/70">
              <AlertTriangle className="h-3 w-3 text-amber-400 mt-0.5 shrink-0" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 9 — Next Steps
// ---------------------------------------------------------------------------

function NextStepsSection({ steps }: { steps: string[] }) {
  if (steps.length === 0) return null;
  return (
    <div data-testid="section-ptp-next-steps">
      <SectionHeader icon={Footprints} label="Next Steps" />
      <ol className="space-y-1.5 list-decimal list-inside">
        {steps.map((step, i) => (
          <li key={i} className="text-xs text-muted-foreground" data-testid={`ptp-step-${i}`}>
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function PortfolioTradePlanCards({ plan }: { plan: PortfolioTradePlan }) {
  const q = plan.qualifiedCandidates.length;

  return (
    <div className="space-y-4" data-testid="section-ptp-root">
      {/* Section 1 — Goal summary */}
      <div className="flex flex-wrap items-center gap-2" data-testid="section-ptp-goal">
        <Badge variant="outline" className="border-primary/30 text-primary/80 bg-primary/5">
          <Target className="h-3 w-3 mr-1" />
          Portfolio-Constrained Plan
        </Badge>
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          {q} candidate{q === 1 ? "" : "s"} evaluated
        </Badge>
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          {plan.portfolioConstraints.length} constraint{plan.portfolioConstraints.length === 1 ? "" : "s"}
        </Badge>
      </div>

      {/* Section 2 — Feasibility */}
      <FeasibilitySection feasibility={plan.feasibility} />

      {/* Section 3 — Constraints */}
      <ConstraintsSection constraints={plan.portfolioConstraints} />

      {/* Section 4 — Qualified Candidates */}
      {plan.qualifiedCandidates.length > 0 && (
        <div data-testid="section-ptp-candidates">
          <SectionHeader icon={TrendingUp} label="Qualified Candidates" />
          <div className="space-y-3">
            {plan.qualifiedCandidates.map((c) => (
              <CandidateCard key={c.symbol + c.rank} c={c} />
            ))}
          </div>
        </div>
      )}

      {/* Section 5 — Why Selected */}
      <WhySelectedSection reasons={plan.whySelected ?? []} />

      {/* Section 6 — Why Alternatives Failed */}
      <AlternativesSection alternatives={plan.alternatives ?? []} />

      {/* Section 7 — Portfolio Impact */}
      <ImpactSection impact={plan.portfolioImpact} />

      {/* Section 8 — Risk */}
      <RiskSection risks={plan.risks} />

      {/* Section 9 — Next Steps */}
      <NextStepsSection steps={plan.nextSteps ?? []} />

      {/* Global warnings */}
      {plan.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-2.5 space-y-1" data-testid="section-ptp-warnings">
          {plan.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] text-amber-100/80">
              <AlertTriangle className="h-3 w-3 text-amber-400 mt-0.5 shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
