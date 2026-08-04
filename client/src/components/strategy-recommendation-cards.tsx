// Deterministic trade-strategy recommendation cards for Ask AI
// ("find a trade for NVDA", "find a credit spread"). Renders ONLY the
// server's validated strategyRecommendation payload — nothing is computed or
// invented client-side. Verdict rules:
//   LIVE_OPTIONS      — full option detail; "Simulated Development Data"
//                       badge when the payload is mock/synthetic.
//   ESTIMATED_OPTIONS — estimates only; NEVER renders live-only fields
//                       (premium, Greeks, bid/ask, OI, volume, contracts).
//   STOCK             — entry/stop/target style candidate levels.
//   WATCH / NO_TRADE / UNSUPPORTED — explanation only, no trade CTA.

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronDown, ChevronRight, Compass, Eye, X } from "lucide-react";
import {
  isRenderableStrategyRecommendation,
  recEvidence,
  REC_VERDICT_LABELS,
  recFmtPrice,
  recIdeaSymbol,
  recStrategyLabel,
  recVerdictTone,
  showsLiveOptionFields,
  type RecIdea,
  type RecommendationEvidence,
  type StrategyRecommendation,
} from "@/lib/strategy-recommendation";

const TONE_CLASS: Record<string, string> = {
  positive: "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
  caution: "border-amber-500/40 text-amber-300 bg-amber-500/10",
  negative: "border-red-500/40 text-red-300 bg-red-500/10",
  neutral: "border-muted text-muted-foreground bg-muted/20",
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

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

function IdeaCard({ idea, simulatedData, rank, total }: { idea: RecIdea; simulatedData: boolean; rank: number; total: number }) {
  const sym = recIdeaSymbol(idea);
  const strat = recStrategyLabel(idea);
  const v = idea.overallVerdict;
  const tone = TONE_CLASS[recVerdictTone(v)] ?? TONE_CLASS.neutral;
  return (
    <div className="rounded-lg border p-3 space-y-2" data-testid={`card-rec-idea-${rank}`}>
      <div className="flex flex-wrap items-center gap-2">
        {total > 1 && <span className="text-xs text-muted-foreground">#{rank}</span>}
        {sym && <span className="text-sm font-semibold">{sym}</span>}
        {strat && <Badge variant="secondary" className="text-[10px]">{strat}</Badge>}
        <Badge variant="outline" className={`text-[10px] ${tone}`} data-testid={`badge-rec-verdict-${rank}`}>
          {REC_VERDICT_LABELS[v] ?? v}
        </Badge>
        {v === "ESTIMATED_OPTIONS" && (
          <Badge variant="outline" className="text-[10px] text-amber-300 border-amber-500/40 bg-amber-500/10">
            Estimates — no live chain
          </Badge>
        )}
        {v === "LIVE_OPTIONS" && simulatedData && (
          <Badge variant="outline" className="text-[10px] text-amber-300 border-amber-500/40 bg-amber-500/10" data-testid={`badge-rec-simulated-${rank}`}>
            Simulated Development Data
          </Badge>
        )}
      </div>
      {idea.strategySummary && <p className="text-xs text-muted-foreground">{idea.strategySummary}</p>}
      {(v === "STOCK" || v === "LIVE_OPTIONS" || v === "ESTIMATED_OPTIONS") && <LevelGrid idea={idea} />}
      {(v === "LIVE_OPTIONS" || v === "ESTIMATED_OPTIONS") && <OptionDetail idea={idea} />}
      {(idea.reasons ?? []).length > 0 && (
        <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5" data-testid={`list-rec-reasons-${rank}`}>
          {(idea.reasons ?? []).slice(0, 5).map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      {v === "UNSUPPORTED" && (idea.alternatives ?? []).length > 0 && (
        <div className="text-xs" data-testid={`text-rec-alternatives-${rank}`}>
          <span className="text-muted-foreground">Safer supported alternatives:</span>{" "}
          {(idea.alternatives ?? [])
            .map((a) => (typeof a === "string" ? a : str((a as Record<string, unknown>)?.strategy)))
            .filter(Boolean)
            .map((a) => String(a).replace(/_/g, " "))
            .join(", ")}
        </div>
      )}
      {(idea.warnings ?? []).length > 0 && (
        <div className="text-xs text-amber-300/90">{(idea.warnings ?? []).slice(0, 3).join(" · ")}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recommendation evidence (transparency) — renders ONLY the server-derived
// recommendationEvidence payload. Sections are collapsed by default.
// ---------------------------------------------------------------------------

function CollapsibleSection({ title, testId, defaultOpen = false, children }: { title: string; testId: string; defaultOpen?: boolean; children: React.ReactNode }) {
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
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {title}
      </button>
      {open && <div className="px-3 pb-3 space-y-1.5" data-testid={`section-${testId}`}>{children}</div>}
    </div>
  );
}

const EVAL_STATUS_STYLE: Record<string, { label: string; cls: string; icon: "check" | "x" | "eye" }> = {
  READY: { label: "Ready", cls: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10", icon: "check" },
  WATCH: { label: "Watch", cls: "text-amber-300 border-amber-500/40 bg-amber-500/10", icon: "eye" },
  REJECTED: { label: "Rejected", cls: "text-red-300 border-red-500/40 bg-red-500/10", icon: "x" },
  SUPPORTING: { label: "Supporting", cls: "text-sky-300 border-sky-500/40 bg-sky-500/10", icon: "check" },
  ALTERNATIVE: { label: "Alternative", cls: "text-muted-foreground border-muted bg-muted/20", icon: "eye" },
};

const CONF_LEVEL_CLS: Record<string, string> = {
  HIGH: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
  MEDIUM: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  LOW: "text-red-300 border-red-500/40 bg-red-500/10",
};

function EvidenceSections({ evidence, verdicts }: { evidence: RecommendationEvidence; verdicts: string[] }) {
  const s = evidence.summary;
  const showWatch = evidence.watchConditions.length > 0 && verdicts.some((v) => v === "WATCH" || v === "NO_TRADE");
  return (
    <div className="space-y-2" data-testid="section-rec-evidence">
      {/* Evaluation Summary — truthful counts only, always visible. */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]" data-testid="row-rec-eval-summary">
        <span className="text-muted-foreground font-medium">Evaluation Summary:</span>
        {s.strategiesEvaluated != null && (
          <Badge variant="outline" className="text-[10px]" data-testid="badge-rec-evaluated-count">{s.strategiesEvaluated} evaluated</Badge>
        )}
        <Badge variant="outline" className={`text-[10px] ${s.ideasActionable > 0 ? EVAL_STATUS_STYLE.READY.cls : ""}`}>{s.ideasActionable} actionable</Badge>
        <Badge variant="outline" className={`text-[10px] ${s.ideasWatch > 0 ? EVAL_STATUS_STYLE.WATCH.cls : ""}`}>{s.ideasWatch} watch</Badge>
        <Badge variant="outline" className="text-[10px]">{s.ideasRejected} rejected</Badge>
        <Badge variant="outline" className="text-[10px]" data-testid="badge-rec-data-quality">Data: {s.dataQuality.toLowerCase()}</Badge>
      </div>

      {evidence.evaluations.length > 0 && (
        <CollapsibleSection title="Strategy Evaluation" testId="rec-strategy-evaluation">
          {evidence.evaluations.map((e, i) => {
            const st = EVAL_STATUS_STYLE[e.status] ?? EVAL_STATUS_STYLE.ALTERNATIVE;
            return (
              <div key={i} className="text-xs flex items-start gap-2" data-testid={`row-rec-evaluation-${i}`}>
                {st.icon === "x" ? <X className="h-3.5 w-3.5 mt-0.5 text-red-300 shrink-0" /> : st.icon === "eye" ? <Eye className="h-3.5 w-3.5 mt-0.5 text-amber-300 shrink-0" /> : <Check className="h-3.5 w-3.5 mt-0.5 text-emerald-300 shrink-0" />}
                <div className="min-w-0">
                  <span className="capitalize">{e.strategy}</span>{" "}
                  <Badge variant="outline" className={`text-[9px] align-middle ${st.cls}`}>{st.label}</Badge>
                  {e.reason && <div className="text-muted-foreground">{e.reason}</div>}
                </div>
              </div>
            );
          })}
        </CollapsibleSection>
      )}

      {evidence.selection && (
        <CollapsibleSection title={`Why ${evidence.selection.strategy} was selected`} testId="rec-selection">
          {evidence.selection.reasons.length > 0 && (
            <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
              {evidence.selection.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
          {evidence.selection.consideredAlternatives.length > 0 && (
            <div className="text-xs">
              <span className="text-muted-foreground">Also considered:</span>{" "}
              <span className="capitalize">{evidence.selection.consideredAlternatives.join(", ")}</span>
            </div>
          )}
        </CollapsibleSection>
      )}

      {evidence.decisionFactors.length > 0 && (
        <CollapsibleSection title="Decision Factors" testId="rec-decision-factors">
          <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
            {evidence.decisionFactors.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </CollapsibleSection>
      )}

      {showWatch && (
        <CollapsibleSection title="What would make this actionable?" testId="rec-watch-conditions">
          <ul className="text-xs space-y-1">
            {evidence.watchConditions.map((c, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <Check className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                {c}
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      <CollapsibleSection
        title={`Recommendation Confidence: ${evidence.confidence.level.toLowerCase()}`}
        testId="rec-confidence"
      >
        <Badge variant="outline" className={`text-[10px] ${CONF_LEVEL_CLS[evidence.confidence.level] ?? ""}`} data-testid="badge-rec-confidence-level">
          {evidence.confidence.level}
        </Badge>
        <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
          {evidence.confidence.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        <p className="text-[10px] text-muted-foreground">
          Confidence in the engine's decision (data completeness and coverage) — not a directional/bullish score.
        </p>
      </CollapsibleSection>
    </div>
  );
}

export function StrategyRecommendationCards({ recommendation }: { recommendation: StrategyRecommendation | null | undefined }) {
  if (!isRenderableStrategyRecommendation(recommendation)) return null;
  const rec = recommendation;
  return (
    <div className="space-y-3" data-testid="cards-strategy-recommendation">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Compass className="h-4 w-4 text-muted-foreground" />
            Trade Recommendation{rec.recommendations.length > 1 ? "s" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {rec.simulatedData && (
            <Badge variant="outline" className="text-[10px] text-amber-300 border-amber-500/40 bg-amber-500/10" data-testid="badge-rec-simulated-data">
              Simulated Development Data — not live market data
            </Badge>
          )}
          {rec.recommendations.map((idea, i) => (
            <IdeaCard key={i} idea={idea} simulatedData={rec.simulatedData} rank={i + 1} total={rec.recommendations.length} />
          ))}
          {(rec.warnings ?? []).length > 0 && (
            <div className="text-xs text-amber-300/90" data-testid="text-rec-warnings">
              {(rec.warnings ?? []).slice(0, 3).join(" · ")}
            </div>
          )}
          {(() => {
            const ev = recEvidence(rec);
            return ev ? <EvidenceSections evidence={ev} verdicts={rec.recommendations.map((i) => i.overallVerdict)} /> : null;
          })()}
          <p className="text-[11px] text-muted-foreground">
            Deterministic recommendation engine output — AI-generated research, not investment advice.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
