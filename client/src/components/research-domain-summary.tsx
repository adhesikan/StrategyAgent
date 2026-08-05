// Sprint 5.4D — Domain-specific summary components.
// Only renders fields present in the stored record.
// Never reconstructs evidence from GPT prose.
// Options with estimated data are clearly labeled.

import { AlertTriangle, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ResearchRecord, ResearchDomain } from "@/lib/research-records";

interface DomainSummaryProps {
  record: ResearchRecord;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5 border-b border-border/40 last:border-0 text-xs">
      <dt className="text-muted-foreground font-medium col-span-1">{label}</dt>
      <dd className="col-span-2 text-foreground">{children}</dd>
    </div>
  );
}

function SnapValue({ snap, path }: { snap: Record<string, unknown>; path: string }) {
  const parts = path.split(".");
  let cur: unknown = snap;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  if (cur == null) return null;
  if (typeof cur === "boolean") return <>{cur ? "Yes" : "No"}</>;
  if (typeof cur === "number") return <>{cur}</>;
  if (typeof cur === "string") return <>{cur}</>;
  if (Array.isArray(cur)) return <>{cur.join(", ")}</>;
  return null;
}

// ── SYMBOL_ANALYSIS ──────────────────────────────────────────────────────────

function SymbolAnalysisSummary({ record }: DomainSummaryProps) {
  const snap = record.domainSnapshot as Record<string, unknown>;
  const vcp = snap.vcpAnalysis as Record<string, unknown> | undefined;
  if (!vcp) return null;
  return (
    <dl>
      {vcp.pattern && <Field label="Pattern"><span className="font-mono">{String(vcp.pattern)}</span></Field>}
      {vcp.stage && <Field label="Stage">{String(vcp.stage)}</Field>}
      {vcp.resistance != null && <Field label="Resistance">${Number(vcp.resistance).toFixed(2)}</Field>}
      {vcp.support != null && <Field label="Support">${Number(vcp.support).toFixed(2)}</Field>}
      {vcp.contractionCount != null && <Field label="Contractions">{String(vcp.contractionCount)}</Field>}
      {vcp.contractionSequence && Array.isArray(vcp.contractionSequence) && (
        <Field label="Sequence">
          <span className="font-mono text-[10px]">
            {(vcp.contractionSequence as number[]).map((v) => `${v.toFixed(1)}%`).join(" → ")}
          </span>
        </Field>
      )}
    </dl>
  );
}

// ── TRADE_RESEARCH ────────────────────────────────────────────────────────────

function TradeResearchSummary({ record }: DomainSummaryProps) {
  const snap = record.domainSnapshot as Record<string, unknown>;
  const rec = snap.recommendation as Record<string, unknown> | undefined;
  if (!rec) return null;
  const recs = (rec.recommendations as Array<Record<string, unknown>> | undefined) ?? [];
  if (recs.length === 0) return <p className="text-xs text-muted-foreground">No trade recommendations in snapshot.</p>;
  return (
    <div className="space-y-3">
      {recs.slice(0, 3).map((r, i) => (
        <dl key={i} className={i > 0 ? "border-t border-border/40 pt-3" : ""}>
          {r.symbol && <Field label="Symbol"><span className="font-mono font-semibold">{String(r.symbol)}</span></Field>}
          {r.strategy && <Field label="Strategy">{String(r.strategyDisplayName ?? r.strategy)}</Field>}
          {r.direction && <Field label="Direction"><span className="capitalize">{String(r.direction)}</span></Field>}
          {r.qualificationStatus && <Field label="Status">{String(r.qualificationStatus)}</Field>}
          {r.maxRisk != null && <Field label="Max risk">${Number(r.maxRisk).toFixed(0)}</Field>}
        </dl>
      ))}
    </div>
  );
}

// ── MARKET_OPPORTUNITY_SEARCH ─────────────────────────────────────────────────

function MarketOpportunitySummary({ record }: DomainSummaryProps) {
  const snap = record.domainSnapshot as Record<string, unknown>;
  const rs = snap.rankedSearch as Record<string, unknown> | undefined;
  if (!rs) return null;
  const candidates = (rs.candidates as Array<Record<string, unknown>> | undefined) ?? [];
  return (
    <div className="space-y-2">
      {rs.excludedCount != null && (
        <p className="text-[11px] text-muted-foreground">
          {Number(rs.excludedCount)} candidates screened out before ranking.
        </p>
      )}
      {candidates.length === 0 ? (
        <p className="text-xs text-muted-foreground">No ranked candidates in snapshot.</p>
      ) : (
        <div className="space-y-2">
          {candidates.slice(0, 5).map((c, i) => (
            <dl key={i} className="flex items-start gap-3">
              <span className="text-muted-foreground text-xs w-4 shrink-0">{i + 1}.</span>
              <div className="flex-1">
                <dt className="sr-only">Candidate {i + 1}</dt>
                <dd className="flex flex-wrap gap-1.5 items-center">
                  {c.symbol && <span className="font-mono font-semibold text-sm">{String(c.symbol)}</span>}
                  {c.strategyDisplayName && <Badge variant="outline" className="text-[10px]">{String(c.strategyDisplayName)}</Badge>}
                  {c.maxRisk != null && <span className="text-xs text-muted-foreground">${Number(c.maxRisk).toFixed(0)} risk</span>}
                </dd>
              </div>
            </dl>
          ))}
          {candidates.length > 5 && (
            <p className="text-[10px] text-muted-foreground">+{candidates.length - 5} more candidates in record.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── PORTFOLIO_GOAL_RESEARCH ───────────────────────────────────────────────────

function PortfolioGoalSummary({ record }: DomainSummaryProps) {
  const snap = record.domainSnapshot as Record<string, unknown>;
  const plan = snap.portfolioTradePlan as Record<string, unknown> | undefined;
  if (!plan) return null;
  const feasibility = plan.feasibility as Record<string, unknown> | undefined;
  const candidates = (plan.qualifiedCandidates as Array<Record<string, unknown>> | undefined) ?? [];
  const constraints = (plan.portfolioConstraints as string[] | undefined) ?? [];
  return (
    <dl className="space-y-0">
      {feasibility?.feasible != null && (
        <Field label="Feasible">{feasibility.feasible ? "Yes" : "No"}</Field>
      )}
      {feasibility?.reason && <Field label="Assessment">{String(feasibility.reason)}</Field>}
      {candidates.length > 0 && (
        <Field label="Qualified candidates">
          <span className="font-mono">{candidates.map((c) => c.symbol).join(", ")}</span>
        </Field>
      )}
      {constraints.length > 0 && (
        <Field label="Constraints">
          <ul className="space-y-0.5">
            {constraints.map((c, i) => <li key={i}>• {c}</li>)}
          </ul>
        </Field>
      )}
    </dl>
  );
}

// ── PORTFOLIO_IMPACT ──────────────────────────────────────────────────────────

function PortfolioImpactSummary({ record }: DomainSummaryProps) {
  const snap = record.domainSnapshot as Record<string, unknown>;
  const pi = snap.portfolioIntelligence as Record<string, unknown> | undefined;
  if (!pi) return null;
  const hasCtx = pi.hasPortfolioContext as boolean | undefined;
  const cash = pi.cashUtilization as Record<string, unknown> | undefined;
  const impacts = (pi.candidateImpact as Array<Record<string, unknown>> | undefined) ?? [];
  const questions = (pi.nextResearchQuestions as string[] | undefined) ?? [];
  return (
    <dl>
      <Field label="Portfolio context">{hasCtx ? "Available" : "Unavailable"}</Field>
      {cash?.buyingPowerStatus && <Field label="Buying power">{String(cash.buyingPowerStatus)}</Field>}
      {cash?.status && cash.status !== cash.buyingPowerStatus && <Field label="Cash status">{String(cash.status)}</Field>}
      {impacts.length > 0 && (
        <Field label="Candidate impact">
          <ul className="space-y-0.5">
            {impacts.slice(0, 4).map((imp, i) => (
              <li key={i}>
                <span className="font-mono">{String(imp.symbol ?? "?")}</span>
                {imp.concentrationAfterPct != null && <span className="text-muted-foreground ml-1">~{Number(imp.concentrationAfterPct).toFixed(1)}% est. concentration</span>}
              </li>
            ))}
          </ul>
        </Field>
      )}
      {questions.length > 0 && (
        <Field label="Research questions">
          <ul className="space-y-0.5">
            {questions.slice(0, 3).map((q, i) => <li key={i} className="text-[11px]">• {q}</li>)}
          </ul>
        </Field>
      )}
    </dl>
  );
}

// ── OPTIONS_RESEARCH ──────────────────────────────────────────────────────────

function OptionsResearchSummary({ record }: DomainSummaryProps) {
  const snap = record.domainSnapshot as Record<string, unknown>;
  const opts = snap.options as Record<string, unknown> | undefined;
  if (!opts) return null;
  const estimated = record.dataQuality?.estimated ?? false;
  const strategies = (opts.strategies as Array<Record<string, unknown>> | undefined) ?? [];
  return (
    <div className="space-y-2">
      {estimated && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs flex items-start gap-2" data-testid="alert-estimated-options">
          <Info className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
          <span className="text-amber-100/90">
            <strong>Estimated Research</strong> — values computed from Black–Scholes approximation, not live chain data. Live-only contract fields are not shown.
          </span>
        </div>
      )}
      {strategies.length === 0 ? (
        <p className="text-xs text-muted-foreground">No options strategies in snapshot.</p>
      ) : (
        <dl>
          {strategies.map((s, i) => (
            <div key={i} className={i > 0 ? "border-t border-border/40 pt-2 mt-2" : ""}>
              {s.strategy && <Field label="Strategy">{String(s.strategyDisplayName ?? s.strategy)}</Field>}
              {!estimated && s.strike != null && <Field label="Strike">${Number(s.strike).toFixed(2)}</Field>}
              {!estimated && s.expiry && <Field label="Expiry">{String(s.expiry)}</Field>}
              {s.premiumPerContract != null && (
                <Field label={estimated ? "Est. premium" : "Premium"}>
                  ${Number(s.premiumPerContract).toFixed(0)}/contract
                  {estimated && <span className="text-muted-foreground ml-1">(approx.)</span>}
                </Field>
              )}
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

// ── Public router ─────────────────────────────────────────────────────────────

export function ResearchDomainSummary({ record }: DomainSummaryProps) {
  const domain = record.domain as ResearchDomain;
  switch (domain) {
    case "SYMBOL_ANALYSIS":
      return <SymbolAnalysisSummary record={record} />;
    case "TRADE_RESEARCH":
      return <TradeResearchSummary record={record} />;
    case "MARKET_OPPORTUNITY_SEARCH":
      return <MarketOpportunitySummary record={record} />;
    case "PORTFOLIO_GOAL_RESEARCH":
      return <PortfolioGoalSummary record={record} />;
    case "PORTFOLIO_IMPACT":
      return <PortfolioImpactSummary record={record} />;
    case "OPTIONS_RESEARCH":
      return <OptionsResearchSummary record={record} />;
    default:
      return (
        <p className="text-xs text-muted-foreground" data-testid="msg-unknown-domain">
          No domain-specific summary available for this record.
        </p>
      );
  }
}

// ── Shared evidence detail panels used by Research Detail page ───────────────

export function ResearchEvidenceDetail({ record }: DomainSummaryProps) {
  return (
    <div className="space-y-4">
      {record.verdict && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Verdict</h3>
          <p className="text-sm">{record.verdict}</p>
        </div>
      )}

      {record.reasons.length > 0 && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">Supporting Reasons</h3>
          <ul className="space-y-1">
            {record.reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm" data-testid={`reason-${i}`}>
                <span className="text-emerald-400 mt-0.5 shrink-0">✓</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {record.warnings.length > 0 && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">Warnings</h3>
          <ul className="space-y-1">
            {record.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-amber-200/90" data-testid={`warning-${i}`}>
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {record.watchConditions.length > 0 && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">Watch Conditions</h3>
          <ul className="space-y-1">
            {record.watchConditions.map((wc, i) => (
              <li key={i} className="text-sm flex items-start gap-2" data-testid={`watch-${i}`}>
                <span className="text-sky-400 shrink-0">→</span>
                <span>{wc}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {record.limitations.length > 0 && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">Limitations</h3>
          <ul className="space-y-1">
            {record.limitations.map((l, i) => (
              <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5" data-testid={`limitation-${i}`}>
                <Info className="h-3 w-3 mt-0.5 shrink-0" />
                <span>{l}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {record.sourceTools.length > 0 && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">Source Tools</h3>
          <div className="flex flex-wrap gap-1.5">
            {record.sourceTools.map((t, i) => (
              <Badge key={i} variant="outline" className="text-[10px] font-mono" data-testid={`source-tool-${i}`}>
                {t}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
