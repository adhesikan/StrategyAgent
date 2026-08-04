// Deterministic ranked market trade search — sectioned presentation.
// TOP TRADE CANDIDATES (qualified bucket only), WORTH WATCHING
// (watchCandidates only), REJECTION SUMMARY (collapsed by default), and
// DATA LIMITATIONS. The frontend never generates, reorders, or promotes
// candidates, and never opens the Trade Builder automatically.
//
// Sprint 4.1A: distinct empty states (A/B/C/D), user-facing rejection
// language, "what would make it actionable" explanation per rejection reason.

import { Link } from "wouter";
import { AlertTriangle, ChevronDown, Clock, SearchX, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  actionableHint,
  buildEmptyState,
  exclusionCtas,
  rankedCountsLine,
  translateExclusionReason,
  translateRejectionReason,
  unavailableCtas,
  watchCtas,
  type RankedEmptyState,
  type RankedExclusionGroup,
  type RankedRejectionGroup,
  type RankedTradeCandidate,
  type RankedTradeSearch,
  type RankedWatchCandidate,
} from "@/lib/ranked-trade-search";
import { fromRankedCandidate } from "@/lib/trade-plan-view-model";
import { TradePlanCard } from "@/components/trade-plan-card";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function CtaRow({ ctas, testId }: { ctas: { label: string; href: string; primary?: boolean }[]; testId: string }) {
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

// ---------------------------------------------------------------------------
// Empty state (Sprint 4.1A §2 — 4 distinct states)
// ---------------------------------------------------------------------------

const EMPTY_STATE_ICONS: Record<RankedEmptyState["icon"], React.ReactNode> = {
  "no-results":       <SearchX className="h-8 w-8 text-muted-foreground/40" />,
  "not-yet":          <Clock className="h-8 w-8 text-amber-400/60" />,
  "market-unavailable": <WifiOff className="h-8 w-8 text-amber-400/60" />,
  "fallback":         <AlertTriangle className="h-8 w-8 text-amber-400/60" />,
};

function EmptyStateCard({ state }: { state: RankedEmptyState }) {
  return (
    <div
      className="rounded-lg border border-border/50 bg-muted/10 p-6 text-center space-y-3"
      data-testid="section-ranked-empty-state"
    >
      <div className="flex justify-center">{EMPTY_STATE_ICONS[state.icon]}</div>
      <div>
        <div className="text-sm font-semibold" data-testid="text-ranked-empty-headline">
          {state.headline}
        </div>
        <div className="text-xs text-muted-foreground mt-1" data-testid="text-ranked-empty-subtitle">
          {state.subtitle}
        </div>
      </div>
      {state.cta.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {state.cta.map((cta) => (
            <Button key={cta.label} asChild size="sm" variant={cta.primary ? "default" : "outline"} className="h-7 text-xs">
              <Link href={cta.href}>{cta.label}</Link>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Qualified candidate card
// ---------------------------------------------------------------------------

/** QualifiedCard delegates to the shared TradePlanCard. The wrapper keeps
 *  the existing data-testid on the outer container for backward compat with
 *  any tests that still target `card-ranked-candidate-*`. */
function QualifiedCard({ c, requestedMax: _requestedMax }: { c: RankedTradeCandidate; requestedMax?: number }) {
  const vm = fromRankedCandidate(c);
  return (
    <div data-testid={`card-ranked-candidate-${c.symbol}`}>
      {c.strategyScore != null && (
        <div className="text-[10px] text-muted-foreground/70 italic mb-1" data-testid={`text-ranked-score-note-${c.symbol}`}>
          Rank reflects qualification, trigger availability, risk fit, and data completeness — not scanner score alone.
        </div>
      )}
      <TradePlanCard vm={vm} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Watch candidate card
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Exclusion section
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Rejection summary (Sprint 4.1A §4 — reason + what would make it actionable)
// ---------------------------------------------------------------------------

function RejectionRow({ g }: { g: RankedRejectionGroup }) {
  const label = translateRejectionReason(g.reason);
  const hint = actionableHint(g.reason);
  return (
    <div className="text-xs space-y-0.5 pb-2 border-b border-rose-500/10 last:border-0 last:pb-0" data-testid={`row-ranked-rejection-${g.reason}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-rose-300/90 font-medium">{label}</span>
        <span className="text-muted-foreground">— {g.count}</span>
        {g.symbols.length > 0 && (
          <span className="text-muted-foreground/70">({g.symbols.join(", ")})</span>
        )}
      </div>
      {hint && (
        <div className="text-muted-foreground/80 pl-0.5" data-testid={`text-ranked-rejection-hint-${g.reason}`}>
          <span className="text-muted-foreground/50 uppercase text-[10px] tracking-wide mr-1">To qualify:</span>
          {hint}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data limitations section
// ---------------------------------------------------------------------------

function DataLimitationsSection({ search, question }: { search: RankedTradeSearch; question?: string }) {
  if (search.unavailableCount === 0) return null;
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs space-y-1.5" data-testid="section-ranked-data-limitations">
      <div className="font-medium uppercase tracking-wide text-muted-foreground">Data limitations</div>
      <div className="text-amber-100/90">
        {search.unavailableCount} {search.unavailableCount === 1 ? "setup" : "setups"} could not be evaluated because market data was unavailable from the provider. Nothing was fabricated to fill the gap.
      </div>
      <CtaRow ctas={unavailableCtas(question ?? "Find the best trades today")} testId="ctas-ranked-unavailable" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field helper
// ---------------------------------------------------------------------------

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="text-xs">
      <span className="text-muted-foreground">{label}: </span>
      <span>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function RankedTradeSearchCards({
  search,
  question,
  source,
}: {
  search: RankedTradeSearch;
  question?: string;
  /** rankedSearchSource from the server — drives empty state selection. */
  source?: string;
}) {
  const hasResults = search.candidates.length > 0 || search.watchCandidates.length > 0;
  const hasExclusions = (search.excludedCount ?? 0) > 0;
  const hasRejections = search.rejectionSummary.length > 0 || search.rejectedCount > 0;

  // Empty state: derive the correct state (A/B/C/D) and render it
  // instead of the normal candidate sections.
  if (!hasResults) {
    const state = buildEmptyState(search, source, question);
    if (state) {
      return (
        <div className="space-y-4" data-testid="section-ranked-trade-search">
          <div className="text-xs text-muted-foreground" data-testid="text-ranked-counts">
            {rankedCountsLine(search)}
          </div>
          <EmptyStateCard state={state} />
          {/* Still show rejections/exclusions for context when present */}
          {hasExclusions && (
            <ExclusionSection
              groups={search.exclusionSummary ?? []}
              totalExcluded={search.excludedCount!}
            />
          )}
          {hasRejections && (
            <details className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3" data-testid="section-ranked-rejections">
              <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 list-none">
                <ChevronDown className="h-3.5 w-3.5" />
                Why setups were rejected ({search.rejectedCount})
              </summary>
              <div className="mt-2 space-y-2">
                {search.rejectionSummary.length === 0 && (
                  <div className="text-xs text-muted-foreground">{search.rejectedCount} {search.rejectedCount === 1 ? "setup was" : "setups were"} rejected during evaluation.</div>
                )}
                {search.rejectionSummary.map((g) => (
                  <RejectionRow key={g.reason} g={g} />
                ))}
              </div>
            </details>
          )}
          <DataLimitationsSection search={search} question={question} />
        </div>
      );
    }
  }

  // Normal (non-empty) result view.
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

      {hasRejections && (
        <details className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3" data-testid="section-ranked-rejections">
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 list-none">
            <ChevronDown className="h-3.5 w-3.5" />
            Rejection Summary — Post-Confluence ({search.rejectedCount})
          </summary>
          <div className="mt-2 space-y-2">
            {search.rejectionSummary.length === 0 && (
              <div className="text-xs text-muted-foreground">{search.rejectedCount} {search.rejectedCount === 1 ? "setup was" : "setups were"} rejected during evaluation.</div>
            )}
            {search.rejectionSummary.map((g) => (
              <RejectionRow key={g.reason} g={g} />
            ))}
          </div>
        </details>
      )}

      <DataLimitationsSection search={search} question={question} />
    </div>
  );
}
