// Deterministic ranked market trade search — sectioned presentation.
// TOP TRADE CANDIDATES (qualified bucket only), WORTH WATCHING
// (watchCandidates only), REJECTION SUMMARY (collapsed by default), and
// DATA LIMITATIONS. The frontend never generates, reorders, or promotes
// candidates, and never opens the Trade Builder automatically.

import { Link } from "wouter";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  exclusionCtas,
  qualifiedCtas,
  rankedCountsLine,
  riskFitLine,
  translateExclusionReason,
  unavailableCtas,
  watchCtas,
  type RankedExclusionGroup,
  type RankedTradeCandidate,
  type RankedTradeSearch,
  type RankedWatchCandidate,
} from "@/lib/ranked-trade-search";

function CtaRow({ ctas, testId }: { ctas: ReturnType<typeof qualifiedCtas>; testId: string }) {
  return (
    <div className="flex flex-wrap gap-2 pt-1" data-testid={testId}>
      {ctas.map((cta) => (
        <Button key={cta.label} asChild size="sm" variant={cta.primary ? "default" : "outline"} className="h-7 text-xs">
          <Link href={cta.href}>{cta.label}</Link>
        </Button>
      ))}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="text-xs">
      <span className="text-muted-foreground">{label}: </span>
      <span>{value}</span>
    </div>
  );
}

function QualifiedCard({ c, requestedMax }: { c: RankedTradeCandidate; requestedMax?: number }) {
  const risk = riskFitLine(c, requestedMax);
  return (
    <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 space-y-1.5" data-testid={`card-ranked-candidate-${c.symbol}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground">#{c.rank}</Badge>
        <span className="font-semibold">{c.symbol}</span>
        <Badge variant="outline" className="border-emerald-500/40 text-emerald-300 bg-emerald-500/10">TRADE CANDIDATE</Badge>
        {c.strategy && <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground">{c.strategy}</Badge>}
        {c.setupStatus && <Badge variant="outline" className="border-sky-500/40 text-sky-300 bg-sky-500/10">{c.setupStatus}</Badge>}
      </div>
      <Field label="Instrument" value={c.structure ?? c.instrument} />
      <Field label="Trigger" value={c.trigger} />
      <Field label="Invalidation" value={c.invalidation} />
      <Field label="Objective" value={c.objective} />
      <Field label="Reward/Risk" value={c.rewardRisk} />
      {risk && <div className="text-xs" data-testid={`text-ranked-risk-${c.symbol}`}>{risk}</div>}
      <Field label="Quantity" value={c.quantity} />
      <Field label="Confidence" value={c.confidence} />
      <Field label="Data quality" value={c.dataQuality} />
      {c.whySelected.length > 0 && (
        <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
          {c.whySelected.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      {c.warnings.length > 0 && (
        <ul className="text-xs text-amber-300/90 list-disc pl-4 space-y-0.5" data-testid={`list-ranked-warnings-${c.symbol}`}>
          {c.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      <CtaRow ctas={qualifiedCtas(c)} testId={`ctas-ranked-candidate-${c.symbol}`} />
    </div>
  );
}

function WatchCard({ w }: { w: RankedWatchCandidate }) {
  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 space-y-1.5" data-testid={`card-ranked-watch-${w.symbol}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{w.symbol}</span>
        <Badge variant="outline" className="border-amber-500/40 text-amber-300 bg-amber-500/10">WATCH — NOT ACTIONABLE</Badge>
        {w.strategy && <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground">{w.strategy}</Badge>}
      </div>
      <Field label="Current stage" value={w.currentStage} />
      <Field label="Missing confirmation" value={w.missingConfirmation} />
      {w.watchConditions.length > 0 && (
        <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
          {w.watchConditions.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
      <CtaRow ctas={watchCtas(w)} testId={`ctas-ranked-watch-${w.symbol}`} />
    </div>
  );
}

function ExclusionSection({ groups, totalExcluded }: { groups: RankedExclusionGroup[]; totalExcluded: number }) {
  return (
    <details className="rounded-lg border border-muted/40 bg-muted/10 p-3" data-testid="section-ranked-exclusions">
      <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 list-none">
        <ChevronDown className="h-3.5 w-3.5" />
        Excluded Before Qualification ({totalExcluded})
      </summary>
      <div className="mt-2 space-y-1.5">
        <div className="text-xs text-muted-foreground">
          These opportunities were filtered out before confluence or quality assessment — they are not rejections.
        </div>
        {groups.length === 0 && (
          <div className="text-xs text-muted-foreground">{totalExcluded} {totalExcluded === 1 ? "opportunity was" : "opportunities were"} excluded.</div>
        )}
        {groups.map((g) => (
          <div key={g.reason} className="text-xs" data-testid={`row-ranked-exclusion-${g.reason}`}>
            <span className="text-foreground/80">{translateExclusionReason(g.reason)}</span>
            <span className="text-muted-foreground"> — {g.count}</span>
          </div>
        ))}
        <CtaRow ctas={exclusionCtas()} testId="ctas-ranked-excluded" />
      </div>
    </details>
  );
}

export function RankedTradeSearchCards({ search, question }: { search: RankedTradeSearch; question?: string }) {
  const limited = search.unavailableCount > 0;
  const hasExclusions = (search.excludedCount ?? 0) > 0;
  return (
    <div className="space-y-4" data-testid="section-ranked-trade-search">
      <div className="text-xs text-muted-foreground" data-testid="text-ranked-counts">
        {rankedCountsLine(search)}
        <span className="block mt-0.5">
          Stored opportunities are raw scanner records. Candidate buckets are formed after confluence and actionability checks.
        </span>
      </div>

      {search.candidates.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground" data-testid="heading-ranked-top">Top trade candidates</div>
          {search.candidates.map((c) => (
            <QualifiedCard key={`${c.rank}-${c.symbol}`} c={c} requestedMax={search.maxRiskDollars} />
          ))}
        </div>
      )}

      {search.watchCandidates.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground" data-testid="heading-ranked-watch">Worth watching</div>
          {search.watchCandidates.map((w) => (
            <WatchCard key={w.symbol} w={w} />
          ))}
        </div>
      )}

      {hasExclusions && (
        <ExclusionSection
          groups={search.exclusionSummary ?? []}
          totalExcluded={search.excludedCount!}
        />
      )}

      {(search.rejectionSummary.length > 0 || search.rejectedCount > 0) && (
        <details className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3" data-testid="section-ranked-rejections">
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 list-none">
            <ChevronDown className="h-3.5 w-3.5" />
            Rejection Summary — Post-Confluence ({search.rejectedCount})
          </summary>
          <div className="mt-2 space-y-1.5">
            {search.rejectionSummary.length === 0 && (
              <div className="text-xs text-muted-foreground">{search.rejectedCount} setups were rejected during evaluation.</div>
            )}
            {search.rejectionSummary.map((g) => (
              <div key={g.reason} className="text-xs" data-testid={`row-ranked-rejection-${g.reason}`}>
                <span className="text-rose-300/90">{g.reason}</span>
                <span className="text-muted-foreground"> — {g.count}</span>
                {g.symbols.length > 0 && <span className="text-muted-foreground"> ({g.symbols.join(", ")})</span>}
              </div>
            ))}
          </div>
        </details>
      )}

      {limited && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs space-y-1.5" data-testid="section-ranked-data-limitations">
          <div className="font-medium uppercase tracking-wide text-muted-foreground">Data limitations</div>
          <div className="text-amber-100/90">
            {search.unavailableCount} {search.unavailableCount === 1 ? "setup" : "setups"} could not be evaluated because market data was unavailable from the provider. Nothing was fabricated to fill the gap.
          </div>
          <CtaRow ctas={unavailableCtas(question ?? "Find the best trades today")} testId="ctas-ranked-unavailable" />
        </div>
      )}
    </div>
  );
}
