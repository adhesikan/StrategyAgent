// Recommendation Experience 2.0 — deterministic trade-strategy recommendation
// presented as a decision-support interface for Ask AI ("find a trade for
// NVDA", "find a credit spread"). Renders ONLY the server's validated
// strategyRecommendation payload — nothing is computed or invented
// client-side. Verdict rules:
//   LIVE_OPTIONS      — full option detail; "Simulated Development Data"
//                       badge when the payload is mock/synthetic.
//   ESTIMATED_OPTIONS — estimates only; NEVER renders live-only fields
//                       (premium, Greeks, bid/ask, OI, volume, contracts).
//   STOCK             — entry/stop/target style candidate levels.
//   WATCH / NO_TRADE / UNSUPPORTED — explanation only, no trade CTA.
//
// Hierarchy (spec §11): Recommendation hero → Decision Summary → Why? →
// Become Actionable When → Recommendation Confidence → Strategy Evaluation →
// Decision Factors → Next Steps. GPT prose renders after this block in
// ask.tsx and never overrides any deterministic field.

import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, Check, ChevronDown, ChevronRight, Compass, Eye, Square, X } from "lucide-react";
import {
  isRenderableStrategyRecommendation,
  recConfidenceChecks,
  recDecisionFactorChips,
  recEnvironmentNotes,
  recEvidence,
  recFmtPrice,
  recIdeaSymbol,
  recNextSteps,
  recStatusLabel,
  recStrategyLabel,
  recStructureLabel,
  recSummaryLines,
  REC_VERDICT_LABELS,
  recVerdictTone,
  showsLiveOptionFields,
  type RecIdea,
  type RecommendationEvidence,
  type StrategyRecommendation,
} from "@/lib/strategy-recommendation";
import { translateNoTradeReason } from "@/lib/ranked-trade-search";
import { fromRecIdea } from "@/lib/trade-plan-view-model";
import { TradePlanCard } from "@/components/trade-plan-card";

// Color system (spec §10): WATCH amber · LIVE green · NO_TRADE gray ·
// UNSUPPORTED blue · environment orange · data quality purple.
const TONE_CLASS: Record<string, string> = {
  positive: "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
  caution: "border-amber-500/40 text-amber-300 bg-amber-500/10",
  negative: "border-muted text-muted-foreground bg-muted/20",
  neutral: "border-sky-500/40 text-sky-300 bg-sky-500/10",
};
const VERDICT_HERO_BORDER: Record<string, string> = {
  LIVE_OPTIONS: "border-emerald-500/40",
  STOCK: "border-emerald-500/40",
  ESTIMATED_OPTIONS: "border-amber-500/40",
  WATCH: "border-amber-500/40",
  NO_TRADE: "border-border",
  UNSUPPORTED: "border-sky-500/40",
};
const CHIP_TONE_CLASS: Record<string, string> = {
  warning: "border-amber-500/40 text-amber-300 bg-amber-500/10",
  environment: "border-orange-500/40 text-orange-300 bg-orange-500/10",
  data: "border-purple-500/40 text-purple-300 bg-purple-500/10",
  neutral: "border-muted text-muted-foreground bg-muted/20",
};
const CONF_LEVEL_CLS: Record<string, string> = {
  HIGH: "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
  MEDIUM: "border-yellow-500/40 text-yellow-300 bg-yellow-500/10",
  LOW: "border-red-500/40 text-red-300 bg-red-500/10",
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function CollapsibleSection({ title, testId, defaultOpen = false, right, children }: { title: React.ReactNode; testId: string; defaultOpen?: boolean; right?: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md border border-border/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-left hover-elevate"
        data-testid={`button-${testId}`}
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <span className="flex-1 min-w-0">{title}</span>
        {right}
      </button>
      {open && <div className="px-3 pb-3 space-y-1.5" data-testid={`section-${testId}`}>{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// §1 Recommendation hero — verdict, symbol, strategy, structure, status,
// confidence readable in under 5 seconds.
// ---------------------------------------------------------------------------

function HeroCard({ idea, rec, evidence }: { idea: RecIdea; rec: StrategyRecommendation; evidence: RecommendationEvidence | null }) {
  const v = idea.overallVerdict;
  const sym = recIdeaSymbol(idea);
  const strat = recStrategyLabel(idea);
  const structure = recStructureLabel(idea);
  const fields: Array<[string, React.ReactNode]> = [];
  if (strat) fields.push(["Strategy", strat]);
  if (structure) fields.push(["Structure", structure]);
  fields.push(["Status", recStatusLabel(v)]);
  if (evidence) {
    fields.push([
      "Recommendation Confidence",
      <Badge key="conf" variant="outline" className={`text-[10px] ${CONF_LEVEL_CLS[evidence.confidence.level] ?? ""}`} data-testid="badge-rec-hero-confidence">
        {evidence.confidence.level.charAt(0) + evidence.confidence.level.slice(1).toLowerCase()}
      </Badge>,
    ]);
  }
  return (
    <div className={`rounded-lg border-2 p-4 space-y-3 ${VERDICT_HERO_BORDER[v] ?? "border-border"}`} data-testid="card-rec-hero">
      <div className="flex items-center gap-3 flex-wrap">
        <Badge variant="outline" className={`text-sm px-3 py-1 font-semibold ${TONE_CLASS[recVerdictTone(v)]}`} data-testid="badge-rec-hero-verdict">
          {REC_VERDICT_LABELS[v] ?? v}
        </Badge>
        {sym && <span className="text-xl font-bold tracking-tight" data-testid="text-rec-hero-symbol">{sym}</span>}
        {v === "ESTIMATED_OPTIONS" && (
          <Badge variant="outline" className="text-[10px] text-amber-300 border-amber-500/40 bg-amber-500/10">Estimates — no live chain</Badge>
        )}
        {rec.simulatedData && (
          <Badge variant="outline" className="text-[10px] text-purple-300 border-purple-500/40 bg-purple-500/10" data-testid="badge-rec-simulated-data">
            Simulated Development Data
          </Badge>
        )}
        {/* §6 — Specific NO_TRADE / WATCH reason chip. Shows the primary
            rejection reason alongside the verdict instead of only the generic
            "No trade" label. Only rendered when a structured reason code is
            present (idea.rejectionReasonCode) — older responses omit it
            gracefully. */}
        {(v === "NO_TRADE" || v === "WATCH") && (() => {
          const label = translateNoTradeReason(idea.rejectionReasonCode);
          return label ? (
            <Badge
              variant="outline"
              className="text-[10px] border-amber-500/40 text-amber-300 bg-amber-500/10"
              data-testid="badge-rec-no-trade-reason"
            >
              {label}
            </Badge>
          ) : null;
        })()}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-sm" data-testid="grid-rec-hero-fields">
        {fields.map(([k, val]) => (
          <div key={String(k)} className="min-w-0">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</div>
            <div className="font-medium truncate">{val}</div>
          </div>
        ))}
      </div>
      <div className="text-sm text-muted-foreground space-y-0.5" data-testid="text-rec-hero-summary">
        {recSummaryLines(rec).map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §2 Decision Summary — counts + environment, deterministic engine data only.
// ---------------------------------------------------------------------------

function DecisionSummary({ evidence, rec }: { evidence: RecommendationEvidence; rec: StrategyRecommendation }) {
  const s = evidence.summary;
  const env = recEnvironmentNotes(rec);
  const stats: Array<[string, string, string]> = [
    ["Actionable", String(s.ideasActionable), s.ideasActionable > 0 ? "text-emerald-300" : ""],
    ["Watch", String(s.ideasWatch), s.ideasWatch > 0 ? "text-amber-300" : ""],
    ["Rejected", String(rejectedCount(evidence)), ""],
    ["Data Quality", s.dataQuality.charAt(0) + s.dataQuality.slice(1).toLowerCase(), "text-purple-300"],
  ];
  return (
    <div className="rounded-md border border-border/60 p-3 space-y-2" data-testid="card-rec-decision-summary">
      <div className="text-xs font-medium">Decision Summary</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {stats.map(([label, value, cls]) => (
          <div key={label} className="rounded bg-muted/20 px-2.5 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className={`text-sm font-semibold tabular-nums ${cls}`} data-testid={`text-rec-summary-${label.toLowerCase().replace(/ /g, "-")}`}>{value}</div>
          </div>
        ))}
      </div>
      {env.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="row-rec-environment">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Environment</span>
          {env.map((n, i) => (
            <Badge key={i} variant="outline" className="text-[10px] border-orange-500/40 text-orange-300 bg-orange-500/10">{n}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}

/** Rejected count for display: strategiesEvaluated − actionable − watch when
 *  the engine stated a total, otherwise the idea-level rejected count. */
function rejectedCount(evidence: RecommendationEvidence): number {
  const s = evidence.summary;
  if (s.strategiesEvaluated != null) {
    return Math.max(0, s.strategiesEvaluated - s.ideasActionable - s.ideasWatch);
  }
  return s.ideasRejected;
}

// ---------------------------------------------------------------------------
// §3 Why? — deterministic reasons/warnings as ✓/✕ lines.
// ---------------------------------------------------------------------------

function WhySection({ idea }: { idea: RecIdea }) {
  const reasons = (idea.reasons ?? []).slice(0, 5);
  const warnings = (idea.warnings ?? []).slice(0, 3);
  if (reasons.length === 0 && warnings.length === 0) return null;
  const positiveVerdict = idea.overallVerdict === "LIVE_OPTIONS" || idea.overallVerdict === "ESTIMATED_OPTIONS" || idea.overallVerdict === "STOCK";
  return (
    <div className="rounded-md border border-border/60 p-3 space-y-1.5" data-testid="card-rec-why">
      <div className="text-xs font-medium">Why?</div>
      <ul className="text-xs space-y-1">
        {reasons.map((r, i) => (
          <li key={`r${i}`} className="flex items-start gap-1.5" data-testid={`text-rec-why-${i}`}>
            {positiveVerdict ? <Check className="h-3.5 w-3.5 mt-0.5 text-emerald-400 shrink-0" /> : <X className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />}
            <span>{r}</span>
          </li>
        ))}
        {warnings.map((w, i) => (
          <li key={`w${i}`} className="flex items-start gap-1.5 text-amber-200/90">
            <X className="h-3.5 w-3.5 mt-0.5 text-amber-400 shrink-0" />
            <span>{w}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §4 Become Actionable When — engine-supplied conditions only.
// ---------------------------------------------------------------------------

function BecomeActionable({ evidence }: { evidence: RecommendationEvidence }) {
  if (evidence.watchConditions.length === 0) return null;
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.04] p-3 space-y-1.5" data-testid="card-rec-become-actionable">
      <div className="text-xs font-medium">Become Actionable When</div>
      <ul className="text-xs space-y-1">
        {evidence.watchConditions.map((c, i) => (
          <li key={i} className="flex items-start gap-1.5" data-testid={`text-rec-watch-condition-${i}`}>
            <Square className="h-3 w-3 mt-0.5 text-amber-400/70 shrink-0" />
            <span>{c}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §5 Recommendation Confidence — level + expandable evidence-quality checks.
// ---------------------------------------------------------------------------

function ConfidenceSection({ evidence, rec }: { evidence: RecommendationEvidence; rec: StrategyRecommendation }) {
  const level = evidence.confidence.level;
  const checks = recConfidenceChecks(evidence, rec);
  return (
    <CollapsibleSection
      testId="rec-confidence"
      title={
        <span className="flex items-center gap-2">
          Recommendation Confidence
          <Badge variant="outline" className={`text-[10px] ${CONF_LEVEL_CLS[level] ?? ""}`} data-testid="badge-rec-confidence-level">
            {level.charAt(0) + level.slice(1).toLowerCase()}
          </Badge>
        </span>
      }
    >
      <ul className="text-xs space-y-1">
        {checks.map((c, i) => (
          <li key={i} className="flex items-start gap-1.5" data-testid={`text-rec-confidence-check-${i}`}>
            {c.ok ? <Check className="h-3.5 w-3.5 mt-0.5 text-emerald-400 shrink-0" /> : <X className="h-3.5 w-3.5 mt-0.5 text-red-400 shrink-0" />}
            <span className={c.ok ? "" : "text-muted-foreground"}>{c.text}</span>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-muted-foreground">
        Confidence in the engine's decision (data completeness and coverage) — not a directional/bullish score.
      </p>
    </CollapsibleSection>
  );
}

// ---------------------------------------------------------------------------
// §6 Strategy Evaluation panel — collapsed by default.
// ---------------------------------------------------------------------------

const EVAL_STATUS_STYLE: Record<string, { label: string; cls: string; icon: "check" | "x" | "eye" }> = {
  READY: { label: "Ready", cls: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10", icon: "check" },
  WATCH: { label: "Watch", cls: "text-amber-300 border-amber-500/40 bg-amber-500/10", icon: "eye" },
  REJECTED: { label: "Rejected", cls: "text-muted-foreground border-muted bg-muted/20", icon: "x" },
  SUPPORTING: { label: "Supporting", cls: "text-sky-300 border-sky-500/40 bg-sky-500/10", icon: "check" },
  ALTERNATIVE: { label: "Alternative", cls: "text-muted-foreground border-muted bg-muted/20", icon: "eye" },
};

function StrategyEvaluationPanel({ evidence }: { evidence: RecommendationEvidence }) {
  if (evidence.evaluations.length === 0 && evidence.summary.strategiesEvaluated == null) return null;
  const s = evidence.summary;
  return (
    <CollapsibleSection
      testId="rec-strategy-evaluation"
      title={
        <span className="flex items-center gap-2 flex-wrap">
          Strategies Evaluated
          {s.strategiesEvaluated != null && <Badge variant="outline" className="text-[10px]" data-testid="badge-rec-evaluated-count">{s.strategiesEvaluated}</Badge>}
          <span className="text-muted-foreground font-normal">
            {s.ideasActionable} actionable · {s.ideasWatch} watch · {rejectedCount(evidence)} rejected
          </span>
        </span>
      }
    >
      {evidence.evaluations.length === 0 ? (
        <p className="text-xs text-muted-foreground">The engine did not report per-strategy detail for this request.</p>
      ) : (
        evidence.evaluations.map((e, i) => {
          const st = EVAL_STATUS_STYLE[e.status] ?? EVAL_STATUS_STYLE.ALTERNATIVE;
          return (
            <div key={i} className="text-xs flex items-start gap-2 py-1 border-b border-border/40 last:border-0" data-testid={`row-rec-evaluation-${i}`}>
              {st.icon === "x" ? <X className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" /> : st.icon === "eye" ? <Eye className="h-3.5 w-3.5 mt-0.5 text-amber-300 shrink-0" /> : <Check className="h-3.5 w-3.5 mt-0.5 text-emerald-300 shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="capitalize font-medium">{e.strategy}</span>
                  <Badge variant="outline" className={`text-[9px] ${st.cls}`}>{st.label}</Badge>
                </div>
                {e.reason && <div className="text-muted-foreground mt-0.5">{e.reason}</div>}
              </div>
            </div>
          );
        })
      )}
      {evidence.selection && (
        <div className="pt-1.5 text-xs space-y-1" data-testid="section-rec-selection">
          <div className="font-medium capitalize">Why {evidence.selection.strategy} was selected</div>
          {evidence.selection.reasons.length > 0 && (
            <ul className="text-muted-foreground list-disc pl-4 space-y-0.5">
              {evidence.selection.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
          {evidence.selection.consideredAlternatives.length > 0 && (
            <div><span className="text-muted-foreground">Also considered:</span> <span className="capitalize">{evidence.selection.consideredAlternatives.join(", ")}</span></div>
          )}
        </div>
      )}
    </CollapsibleSection>
  );
}

// ---------------------------------------------------------------------------
// §7 Decision Factors — chips that expand into the full engine sentence.
// ---------------------------------------------------------------------------

function DecisionFactorChips({ evidence }: { evidence: RecommendationEvidence }) {
  const chips = recDecisionFactorChips(evidence.decisionFactors);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  if (chips.length === 0) return null;
  return (
    <div className="rounded-md border border-border/60 p-3 space-y-2" data-testid="card-rec-decision-factors">
      <div className="text-xs font-medium">Decision Factors</div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setOpenIdx(openIdx === i ? null : i)}
            aria-expanded={openIdx === i}
            data-testid={`chip-rec-factor-${i}`}
          >
            <Badge variant="outline" className={`text-[10px] cursor-pointer ${CHIP_TONE_CLASS[c.tone]}`}>{c.label}</Badge>
          </button>
        ))}
      </div>
      {openIdx != null && chips[openIdx] && (
        <p className="text-xs text-muted-foreground" data-testid="text-rec-factor-detail">{chips[openIdx].detail}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trade detail (levels + options) — unchanged data rules from v1.
// ---------------------------------------------------------------------------

function LevelGrid({ idea }: { idea: RecIdea }) {
  const cand = (idea.tradeCandidate ?? {}) as Record<string, unknown>;
  const pos = (idea.recommendedPosition ?? {}) as Record<string, unknown>;
  const risk = (idea.riskAssessment ?? {}) as Record<string, unknown>;
  const rows: Array<[string, string | null]> = [
    ["Entry", recFmtPrice(num(cand.entry ?? cand.entryPrice ?? cand.trigger))],
    ["Stop", recFmtPrice(num(cand.stop ?? cand.stopPrice ?? cand.invalidation))],
    ["Target", recFmtPrice(num(cand.target ?? cand.targetPrice ?? cand.technicalObjective))],
    ["Max risk", recFmtPrice(num(risk.maxRiskDollars ?? risk.maxLoss ?? pos.maxRiskDollars))],
    ["Size", str(pos.sizeDescription) ?? (num(pos.shares) != null ? `${num(pos.shares)} shares` : num(pos.contracts) != null ? `${num(pos.contracts)} contract${num(pos.contracts) === 1 ? "" : "s"}` : null)],
  ];
  const visible = rows.filter(([, v]) => v != null);
  if (visible.length === 0) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs" data-testid="grid-rec-levels">
      {visible.map(([k, v]) => (
        <div key={k}>
          <span className="text-muted-foreground">{k}:</span> {v}
        </div>
      ))}
    </div>
  );
}

function OptionDetail({ idea }: { idea: RecIdea }) {
  const oa = (idea.optionAnalysis ?? {}) as Record<string, unknown>;
  if (Object.keys(oa).length === 0) return null;
  const live = showsLiveOptionFields(idea);
  const rows: Array<[string, string | null]> = [];
  const dte = num(oa.dte ?? oa.targetDTE);
  if (dte != null) rows.push(["DTE", String(dte)]);
  const strike = num(oa.strike) ?? str(oa.strikeZone ?? oa.strikeDescription);
  if (strike != null) rows.push(["Strike" + (live ? "" : " zone (est.)"), typeof strike === "number" ? recFmtPrice(strike) : strike]);
  if (live) {
    // Live-only fields — allowed ONLY when a real chain was fetched.
    // Exact expiration counts as live-only; estimated mode shows DTE instead.
    const expiry = str(oa.expiration ?? oa.expiry);
    if (expiry) rows.push(["Expiration", expiry]);
    const prem = num(oa.premium ?? oa.mid ?? oa.price);
    if (prem != null) rows.push(["Premium", recFmtPrice(prem)]);
    const delta = num(oa.delta);
    if (delta != null) rows.push(["Delta", delta.toFixed(2)]);
    const iv = num(oa.iv ?? oa.impliedVolatility);
    if (iv != null) rows.push(["IV", `${(iv * (iv < 5 ? 100 : 1)).toFixed(0)}%`]);
    const contract = str(oa.contractSymbol ?? oa.contract);
    if (contract) rows.push(["Contract", contract]);
    const liq = str(oa.liquidity);
    if (liq) rows.push(["Liquidity", liq]);
  } else {
    const range = str(oa.historicalRange ?? oa.estimatedRange);
    if (range) rows.push(["Est. range", range]);
  }
  if (rows.length === 0) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs" data-testid="grid-rec-options">
      {rows.map(([k, v]) => (
        <div key={k}>
          <span className="text-muted-foreground">{k}:</span> {v}
        </div>
      ))}
    </div>
  );
}

function TradeDetailSection({ idea }: { idea: RecIdea }) {
  const v = idea.overallVerdict;
  const showLevels = v === "STOCK" || v === "LIVE_OPTIONS" || v === "ESTIMATED_OPTIONS";
  const showOptions = v === "LIVE_OPTIONS" || v === "ESTIMATED_OPTIONS";
  if (!showLevels && !showOptions) return null;
  const hasContent =
    (idea.tradeCandidate && Object.keys(idea.tradeCandidate).length > 0) ||
    (idea.recommendedPosition && Object.keys(idea.recommendedPosition).length > 0) ||
    (idea.optionAnalysis && Object.keys(idea.optionAnalysis).length > 0);
  if (!hasContent) return null;
  return (
    <div className="rounded-md border border-border/60 p-3 space-y-2" data-testid="card-rec-trade-detail">
      <div className="text-xs font-medium">Trade Detail</div>
      {showLevels && <LevelGrid idea={idea} />}
      {showOptions && <OptionDetail idea={idea} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// §9 Next Steps — verdict-aware CTAs.
// ---------------------------------------------------------------------------

function NextSteps({ idea, simulatedData }: { idea: RecIdea; simulatedData: boolean }) {
  const steps = recNextSteps(idea, simulatedData);
  if (steps.length === 0) return null;
  return (
    <div className="space-y-1.5" data-testid="card-rec-next-steps">
      <div className="text-xs font-medium">Next Steps</div>
      <div className="flex flex-wrap gap-2">
        {steps.map((s, i) => (
          <Link key={i} href={s.href}>
            <Button variant="outline" size="sm" className="gap-1" data-testid={`button-rec-next-step-${i}`}>
              {s.label}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Secondary ideas (multi-idea responses) — compact rows below the hero.
// ---------------------------------------------------------------------------

function SecondaryIdeaRow({ idea, rank }: { idea: RecIdea; rank: number }) {
  const sym = recIdeaSymbol(idea);
  const strat = recStrategyLabel(idea);
  const v = idea.overallVerdict;
  return (
    <div className="rounded-md border border-border/60 p-2.5 flex items-center gap-2 flex-wrap text-xs" data-testid={`card-rec-idea-${rank}`}>
      <span className="text-muted-foreground">#{rank}</span>
      {sym && <span className="font-semibold">{sym}</span>}
      {strat && <Badge variant="secondary" className="text-[10px]">{strat}</Badge>}
      <Badge variant="outline" className={`text-[10px] ${TONE_CLASS[recVerdictTone(v)]}`} data-testid={`badge-rec-verdict-${rank}`}>
        {REC_VERDICT_LABELS[v] ?? v}
      </Badge>
      {(idea.reasons ?? []).length > 0 && <span className="text-muted-foreground basis-full md:basis-auto md:flex-1 min-w-0 truncate">{idea.reasons![0]}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function StrategyRecommendationCards({ recommendation }: { recommendation: StrategyRecommendation | null | undefined }) {
  if (!isRenderableStrategyRecommendation(recommendation)) return null;
  const rec = recommendation;
  const evidence = recEvidence(rec);
  // Primary idea = first actionable/watch idea, else the first idea.
  const primaryIdx = Math.max(
    0,
    rec.recommendations.findIndex((i) => i.overallVerdict !== "NO_TRADE" && i.overallVerdict !== "UNSUPPORTED"),
  );
  const primary = rec.recommendations[primaryIdx];
  const secondary = rec.recommendations.filter((_, i) => i !== primaryIdx);
  const showBecomeActionable =
    evidence != null &&
    (primary.overallVerdict === "WATCH" || primary.overallVerdict === "NO_TRADE") &&
    evidence.watchConditions.length > 0;
  return (
    <div className="space-y-3" data-testid="cards-strategy-recommendation">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Compass className="h-4 w-4 text-muted-foreground" />
            Recommendation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* §11 hierarchy, single column on mobile, TradePlanCard (§4B) first.
              showDecision=false because WhySection + BecomeActionable below
              already render a richer decision view. */}
          <TradePlanCard
            vm={fromRecIdea(primary, {
              symbol: recIdeaSymbol(primary) ?? undefined,
              simulatedData: rec.simulatedData,
              watchConditions: evidence?.watchConditions,
            })}
            showDecision={false}
            headerExtra={evidence ? (
              <Badge
                variant="outline"
                className={`text-[10px] ${
                  evidence.confidence.level === "HIGH"
                    ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
                    : evidence.confidence.level === "MEDIUM"
                      ? "border-yellow-500/40 text-yellow-300 bg-yellow-500/10"
                      : "border-red-500/40 text-red-300 bg-red-500/10"
                }`}
                data-testid="badge-rec-hero-confidence"
              >
                {evidence.confidence.level.charAt(0) + evidence.confidence.level.slice(1).toLowerCase()} confidence
              </Badge>
            ) : undefined}
          />
          {evidence && <DecisionSummary evidence={evidence} rec={rec} />}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
            <WhySection idea={primary} />
            {showBecomeActionable && evidence && <BecomeActionable evidence={evidence} />}
          </div>
          {/* OptionDetail kept for live/estimated options: DTE, strike, premium,
              delta, IV — fields outside the unified TradePlanCard scope. */}
          {(primary.overallVerdict === "LIVE_OPTIONS" || primary.overallVerdict === "ESTIMATED_OPTIONS") && (
            <TradeDetailSection idea={primary} />
          )}
          {evidence && <ConfidenceSection evidence={evidence} rec={rec} />}
          {evidence && <StrategyEvaluationPanel evidence={evidence} />}
          {evidence && <DecisionFactorChips evidence={evidence} />}
          {secondary.length > 0 && (
            <div className="space-y-1.5" data-testid="section-rec-secondary-ideas">
              <div className="text-xs font-medium text-muted-foreground">Other ideas reviewed</div>
              {secondary.map((idea, i) => (
                <SecondaryIdeaRow key={i} idea={idea} rank={i + 2} />
              ))}
            </div>
          )}
          <NextSteps idea={primary} simulatedData={rec.simulatedData} />
          {(rec.warnings ?? []).length > 0 && !evidence && (
            <div className="text-xs text-amber-300/90" data-testid="text-rec-warnings">
              {(rec.warnings ?? []).slice(0, 3).join(" · ")}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Deterministic recommendation engine output — AI-generated research, not investment advice.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
