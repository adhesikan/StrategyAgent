// Deterministic ranked market trade search — sectioned presentation.
// TOP TRADE CANDIDATES (qualified bucket only), WORTH WATCHING
// (watchCandidates only), REJECTION SUMMARY (collapsed by default), and
// DATA LIMITATIONS. The frontend never generates, reorders, or promotes
// candidates, and never opens the Trade Builder automatically.
//
// Sprint 4.1A: distinct empty states (A/B/C/D), user-facing rejection
// language, "what would make it actionable" explanation per rejection reason.
// Sprint 4.1B: InstitutionalTradeCard replaces TradePlanCard for all
// candidate slots (qualified + watch). Rejection groups retain the compact
// RejectionRow layout (they are aggregate rows, not individual candidate cards).

import { Link } from "wouter";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  actionableHint,
  buildEmptyState,
  buildZeroQualifiedSummary,
  dataRejectionGroups,
  exclusionCtas,
  rankedCountsLine,
  shortExclusionLabel,
  trueRejectionGroups,
  translateRejectionReason,
  unavailableCtas,
  type RankedExclusionGroup,
  type RankedRejectionGroup,
  type RankedTradeSearch,
} from "@/lib/ranked-trade-search";
import { fromRankedCandidate, fromRankedWatchCandidate } from "@/lib/trade-plan-view-model";
import type { RankedTradeCandidate, RankedWatchCandidate } from "@/lib/ranked-trade-search";
import { InstitutionalTradeCard } from "@/components/institutional-trade-card";

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

const EMPTY_STATE_ICONS: Record<string, React.ReactNode> = {
  "no-results":         <AlertTriangle className="h-8 w-8 text-muted-foreground/40" />,
  "not-yet":            <AlertTriangle className="h-8 w-8 text-amber-400/60" />,
  "market-unavailable": <AlertTriangle className="h-8 w-8 text-amber-400/60" />,
  "fallback":           <AlertTriangle className="h-8 w-8 text-amber-400/60" />,
};

function EmptyStateCard({ state }: { state: ReturnType<typeof buildEmptyState> & object }) {
  return (
    <div
      className="rounded-lg border border-border/50 bg-muted/10 p-6 text-center space-y-3"
      data-testid="section-ranked-empty-state"
    >
      <div className="flex justify-center">{EMPTY_STATE_ICONS[state.icon] ?? EMPTY_STATE_ICONS["no-results"]}</div>
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
// Candidate cards — Sprint 4.1B: InstitutionalTradeCard
// ---------------------------------------------------------------------------

function QualifiedCard({ c }: { c: RankedTradeCandidate }) {
  const vm = fromRankedCandidate(c);
  return (
    <div data-testid={`card-ranked-candidate-${c.symbol}`}>
      {c.strategyScore != null && (
        <div className="text-[10px] text-muted-foreground/70 italic mb-1" data-testid={`text-ranked-score-note-${c.symbol}`}>
          Rank reflects qualification, trigger availability, risk fit, and data completeness — not scanner score alone.
        </div>
      )}
      <InstitutionalTradeCard vm={vm} />
    </div>
  );
}

function WatchCard({ w }: { w: RankedWatchCandidate }) {
  const vm = fromRankedWatchCandidate(w);
  return (
    <div data-testid={`card-ranked-watch-${w.symbol}`}>
      <InstitutionalTradeCard vm={vm} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exclusion section (§1 — count-first format, short labels)
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
          These opportunities were filtered before confluence or quality assessment — they are not rejections.
        </div>
        {groups.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            {totalExcluded} {totalExcluded === 1 ? "opportunity was" : "opportunities were"} excluded before qualification.
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.reason} className="text-xs flex items-center gap-2" data-testid={`row-ranked-exclusion-${g.reason}`}>
              <span className="tabular-nums font-semibold text-foreground/70 w-6 text-right shrink-0">{g.count}</span>
              <span className="text-muted-foreground">{shortExclusionLabel(g.reason)}</span>
            </div>
          ))
        )}
        <CtaRow ctas={exclusionCtas()} testId="ctas-ranked-excluded" />
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// §5 — Why Nothing Qualified (deterministic gate summary)
// ---------------------------------------------------------------------------

/**
 * §5 — Why Nothing Qualified.
 * Shows a plain-prose summary of what happened (excluded / unavailable / rejected
 * counts), not a list of gate names that may imply more than the data supports.
 * Only rendered when qualifiedCount = 0 and there is evidence to summarise.
 */
function WhyNothingQualifiedSection({ search }: { search: RankedTradeSearch }) {
  if (search.qualifiedCount > 0) return null;
  const summary = buildZeroQualifiedSummary(search);
  if (!summary) return null;
  return (
    <div
      className="rounded-lg border border-border/50 bg-muted/10 p-3 text-xs space-y-1.5"
      data-testid="section-ranked-why-nothing"
    >
      <div className="font-medium text-muted-foreground uppercase tracking-wide text-[10px]">
        Why Nothing Qualified
      </div>
      <div className="text-muted-foreground">
        No candidate completed every required qualification step.
      </div>
      <div className="text-muted-foreground/80">{summary}</div>
      <div className="text-muted-foreground/50 text-[10px]">
        The engine intentionally returned no trade rather than lowering its standards.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §2 — Unavailable Candidates (separate from Rejected)
// ---------------------------------------------------------------------------

/**
 * Dedicated "Unavailable Candidates" section — never mixed with Rejected.
 * Shows unavailableCount + any data-unavailability rejection groups.
 * Spec §2: "Unavailable candidates must not appear under Rejected."
 */
function UnavailableCandidatesSection({
  search,
  question,
  hideCtas = false,
}: {
  search: RankedTradeSearch;
  question?: string;
  /** When true, suppresses the Retry / Open Scanner CTA row.
   *  Used in empty-state context where a primary CTA is already shown. */
  hideCtas?: boolean;
}) {
  const extraGroups = dataRejectionGroups(search.rejectionSummary);
  const extraCount = extraGroups.reduce((s, g) => s + g.count, 0);
  const totalUnavailable = search.unavailableCount + extraCount;
  if (totalUnavailable === 0 && extraGroups.length === 0) return null;
  return (
    <div
      className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs space-y-1.5"
      data-testid="section-ranked-unavailable"
    >
      <div className="font-medium uppercase tracking-wide text-muted-foreground text-[10px]">
        Unavailable Candidates
      </div>
      <div className="text-amber-100/90">
        {totalUnavailable}{" "}
        {totalUnavailable === 1 ? "setup" : "setups"} could not be evaluated because market data
        was unavailable from the provider. Nothing was fabricated to fill the gap.
      </div>
      {extraGroups.map((g) => (
        <div
          key={g.reason}
          className="text-amber-100/70"
          data-testid={`row-ranked-unavailable-reason-${g.reason}`}
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
      {!hideCtas && (
        <CtaRow
          ctas={unavailableCtas(question ?? "Find the best trades today")}
          testId="ctas-ranked-unavailable"
        />
      )}
    </div>
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

// (DataLimitationsSection replaced by UnavailableCandidatesSection above — §2)

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

  // §3: Only true qualification failures appear in the Rejected section.
  // Data-unavailability groups move to UnavailableCandidatesSection (§2).
  // Use count-only guard — groups with count=0 must not trigger rendering.
  const trueRejections = trueRejectionGroups(search.rejectionSummary);
  const trueRejectedCount = trueRejections.reduce((s, g) => s + g.count, 0);
  const hasRejections = trueRejectedCount > 0; // count-only: never show (0)

  // Shared rejection section JSX used in both empty and normal states.
  const RejectionSection = () =>
    hasRejections ? (
      <details className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3" data-testid="section-ranked-rejections">
        <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 list-none">
          <ChevronDown className="h-3.5 w-3.5" />
          Why setups were rejected ({trueRejectedCount})
        </summary>
        <div className="mt-2 space-y-2">
          <div className="text-[11px] text-muted-foreground/80">
            These setups reached qualification but were rejected because they didn't meet all required conditions.
          </div>
          {trueRejections.map((g) => (
            <RejectionRow key={g.reason} g={g} />
          ))}
        </div>
      </details>
    ) : null;

  // Empty state: derive the correct state (A/B/C/D) and render it
  // instead of the normal candidate sections.
  if (!hasResults) {
    const state = buildEmptyState(search, source, question);
    if (state) {
      // Case C (icon="market-unavailable") already describes unavailability in
      // the EmptyStateCard — suppress UnavailableCandidatesSection to avoid
      // rendering the same information twice.
      const isDataOnlyCase = state.icon === "market-unavailable";

      return (
        <div className="space-y-4" data-testid="section-ranked-trade-search">
          <div className="text-xs text-muted-foreground" data-testid="text-ranked-counts">
            {rankedCountsLine(search)}
          </div>
          {/* §5 — Why nothing qualified (before exclusion/unavailable details) */}
          <WhyNothingQualifiedSection search={search} />
          {/* Exclusion details */}
          {hasExclusions && (
            <ExclusionSection
              groups={search.exclusionSummary ?? []}
              totalExcluded={search.excludedCount!}
            />
          )}
          {/* §2 — Unavailable Candidates before Rejected; suppressed when EmptyStateCard already covers it */}
          {!isDataOnlyCase && (
            <UnavailableCandidatesSection search={search} question={question} hideCtas />
          )}
          {/* §3 — Rejected: true qualification failures only */}
          <RejectionSection />
          {/* Empty state card last — acts as the overall verdict / AI explanation */}
          <EmptyStateCard state={state} />
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

      {/* §B — Qualified candidates only; heading hidden when none qualify */}
      {search.candidates.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground" data-testid="heading-ranked-top">Top trade candidates</div>
          {search.candidates.map((c) => (
            <QualifiedCard key={`${c.rank}-${c.symbol}`} c={c} />
          ))}
        </div>
      )}

      {/* Worth Watching — hidden when watchCount is zero */}
      {search.watchCandidates.length > 0 && (
        <div className="space-y-3">
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

      {/* §2 — Unavailable Candidates before Rejected */}
      <UnavailableCandidatesSection search={search} question={question} />

      {/* §3 — Rejected: true qualification failures only */}
      <RejectionSection />
    </div>
  );
}
