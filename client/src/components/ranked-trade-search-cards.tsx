// Deterministic ranked market trade search — sectioned presentation.
// Sprint 4.5: replaced EmptyStateCard with DeterministicEngineSummaryCard (§1);
// exported ExclusionSection / UnavailableCandidatesSection / WhyNothingQualifiedSection
// so GoalTradePlanner can compose them in the spec §8 order; standardised
// terminology (no "setups", "records", "ideas"); applied §10 status colours.
//
// Frontend rules (never changed):
//   – Never generates, reorders, or promotes candidates.
//   – Never opens the Trade Builder automatically.
//   – Counts come exclusively from the backend payload (§2 single source of truth).

import { useMemo } from "react";
import { Link } from "wouter";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  actionableHint,
  buildDeterministicSummary,
  buildEmptyState,
  dataRejectionGroups,
  exclusionCtas,
  rankedCountsLine,
  shortExclusionLabel,
  trueRejectionGroups,
  translateRejectionReason,
  unavailableCtas,
  zeroQualifiedCtas,
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
// §1 — Deterministic Engine Summary card (replaces EmptyStateCard)
// ---------------------------------------------------------------------------

/**
 * Deterministic Engine Summary card.
 *
 * Replaces the generic EmptyStateCard for zero-qualified results.
 * Shows structured backend counts exactly — never derives or recomputes (§2).
 * Exported so GoalTradePlanner can render it at spec §8 position 2.
 */
export function DeterministicEngineSummaryCard({ search }: { search: RankedTradeSearch }) {
  const rows = buildDeterministicSummary(search).filter((r) => r.show);
  return (
    <div
      className="rounded-lg border border-border/50 bg-background/40 p-3 space-y-2.5"
      data-testid="section-deterministic-summary"
      aria-label="Deterministic engine result summary"
    >
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold">
        Deterministic Engine Result
      </div>
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3 text-xs" data-testid={`row-det-${row.label.replace(/\s+/g, "-").toLowerCase()}`}>
            <span
              className={[
                "tabular-nums font-bold w-7 text-right shrink-0",
                row.color === "green"   ? "text-emerald-400" :
                row.color === "amber"   ? "text-amber-400"   :
                row.color === "muted"   ? "text-foreground/40" :
                                          "text-foreground/80",
              ].join(" ")}
            >
              {row.value}
            </span>
            <span className={row.color === "muted" ? "text-muted-foreground/60" : "text-muted-foreground"}>
              {row.label}
            </span>
          </div>
        ))}
      </div>
      <div className="text-[10px] text-muted-foreground/50 border-t border-border/20 pt-1.5">
        The engine intentionally returned no trade rather than lowering its standards.
      </div>
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
// §4 — Exclusion section (count-first, short labels, no verbose paragraph)
// ---------------------------------------------------------------------------

/**
 * Excluded Before Qualification section.
 *
 * Exported so GoalTradePlanner can render it in the spec §8 order (position 4).
 * `hideCtas` suppresses the CTA row when a primary CTA group already exists
 * elsewhere on the page (§3 — no duplicate CTAs).
 */
export function ExclusionSection({
  groups,
  totalExcluded,
  hideCtas = false,
}: {
  groups: RankedExclusionGroup[];
  totalExcluded: number;
  hideCtas?: boolean;
}) {
  return (
    <details
      className="rounded-lg border border-muted/40 bg-muted/10 p-3"
      data-testid="section-ranked-exclusions"
    >
      <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 list-none">
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        Excluded Before Qualification ({totalExcluded})
      </summary>
      <div className="mt-2 space-y-1" role="list" aria-label="Exclusion reasons">
        {groups.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            {totalExcluded}{" "}
            {totalExcluded === 1 ? "opportunity was" : "opportunities were"} excluded before qualification.
          </div>
        ) : (
          groups.map((g) => (
            <div
              key={g.reason}
              className="text-xs flex items-center gap-2"
              data-testid={`row-ranked-exclusion-${g.reason}`}
              role="listitem"
            >
              <span className="tabular-nums font-semibold text-foreground/70 w-6 text-right shrink-0">{g.count}</span>
              <span className="text-muted-foreground">{shortExclusionLabel(g.reason)}</span>
            </div>
          ))
        )}
        {!hideCtas && <CtaRow ctas={exclusionCtas()} testId="ctas-ranked-excluded" />}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// §5 — Why Nothing Qualified (narrative explanation, no count duplication)
// ---------------------------------------------------------------------------

/**
 * Why Nothing Qualified section — narrative only.
 *
 * Uses `groupedCandidateCount` from the backend for the engine-evaluated line
 * (§2 single source of truth). Does NOT repeat count breakdown — that appears
 * in the dedicated ExclusionSection and UnavailableCandidatesSection below.
 * Exported so GoalTradePlanner can render it at spec §8 position 3.
 */
export function WhyNothingQualifiedSection({ search }: { search: RankedTradeSearch }) {
  if (search.qualifiedCount > 0) return null;
  // Only render when the engine demonstrably ran and evaluated something.
  if (search.groupedCandidateCount === undefined && search.reviewedCount === 0) return null;

  const evaluated = search.groupedCandidateCount;
  const candidateText =
    evaluated !== undefined
      ? `${evaluated} post-confluence ${evaluated === 1 ? "candidate" : "candidates"}`
      : "the available candidates";

  return (
    <div
      className="rounded-lg border border-border/50 bg-muted/10 p-3 text-xs space-y-1.5"
      data-testid="section-ranked-why-nothing"
      aria-label="Why nothing qualified"
    >
      <div className="font-medium text-muted-foreground uppercase tracking-wide text-[10px]">
        Why Nothing Qualified
      </div>
      <div className="text-muted-foreground leading-relaxed">
        The deterministic engine evaluated {candidateText}.{" "}
        None satisfied every required qualification gate, so no trade was produced.
      </div>
      <div className="text-muted-foreground/50 text-[10px]">
        The engine intentionally returned no trade rather than weakening qualification standards.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §2 / §10 — Unavailable Candidates (amber, separate from Rejected)
// ---------------------------------------------------------------------------

/**
 * Unavailable Candidates section — amber colour per §10.
 *
 * Dedicated section for data-unavailability failures (never mixed with Rejected).
 * Exported so GoalTradePlanner can render it at spec §8 position 5.
 * `hideCtas` suppresses the CTA row when the primary CTA group is elsewhere.
 */
export function UnavailableCandidatesSection({
  search,
  question,
  hideCtas = false,
}: {
  search: RankedTradeSearch;
  question?: string;
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
      aria-label="Unavailable candidates"
    >
      <div className="font-medium uppercase tracking-wide text-muted-foreground text-[10px]">
        Unavailable Candidates
      </div>
      <div className="text-amber-100/90">
        {totalUnavailable}{" "}
        {totalUnavailable === 1 ? "candidate" : "candidates"} could not be evaluated because market
        data was unavailable from the provider. Nothing was fabricated to fill the gap.
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
// §3 / §10 — Rejection summary (red, true qualification failures only)
// ---------------------------------------------------------------------------

function RejectionRow({ g }: { g: RankedRejectionGroup }) {
  const label = translateRejectionReason(g.reason);
  const hint = actionableHint(g.reason);
  return (
    <div
      className="text-xs space-y-0.5 pb-2 border-b border-rose-500/10 last:border-0 last:pb-0"
      data-testid={`row-ranked-rejection-${g.reason}`}
    >
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
// Main export
// ---------------------------------------------------------------------------

export function RankedTradeSearchCards({
  search,
  question,
  source,
}: {
  search: RankedTradeSearch;
  question?: string;
  source?: string;
}) {
  const hasResults = search.candidates.length > 0 || search.watchCandidates.length > 0;
  const hasExclusions = (search.excludedCount ?? 0) > 0;

  // §3: Only true qualification failures appear in the Rejected section.
  // Memoised for §11 performance — avoids recomputing on every re-render.
  const trueRejections = useMemo(
    () => trueRejectionGroups(search.rejectionSummary),
    [search.rejectionSummary],
  );
  const trueRejectedCount = useMemo(
    () => trueRejections.reduce((s, g) => s + g.count, 0),
    [trueRejections],
  );
  // Count-only guard — groups with count=0 must not trigger rendering.
  const hasRejections = trueRejectedCount > 0;

  // §3 / §10 — Rejected candidates (red), count-gated.
  const RejectionSection = () =>
    hasRejections ? (
      <details
        className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3"
        data-testid="section-ranked-rejections"
        aria-label="Rejected candidates"
      >
        <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 list-none">
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          Rejected Candidates ({trueRejectedCount})
        </summary>
        <div className="mt-2 space-y-2">
          <div className="text-[11px] text-muted-foreground/80">
            These candidates reached qualification but were rejected because they didn't meet all required conditions.
          </div>
          {trueRejections.map((g) => (
            <RejectionRow key={g.reason} g={g} />
          ))}
        </div>
      </details>
    ) : null;

  // ---------------------------------------------------------------------------
  // Zero-qualified path — DeterministicEngineSummaryCard + ordered detail sections
  // ---------------------------------------------------------------------------

  if (!hasResults) {
    const state = buildEmptyState(search, source, question);
    if (state) {
      // Case C (icon="market-unavailable") already describes unavailability —
      // suppress UnavailableCandidatesSection to avoid duplicate rendering.
      const isDataOnlyCase = state.icon === "market-unavailable";

      return (
        <div className="space-y-4" data-testid="section-ranked-trade-search">
          {/* §2 — Counts line (single source of truth) */}
          <div className="text-xs text-muted-foreground" data-testid="text-ranked-counts">
            {rankedCountsLine(search)}
          </div>

          {/* §1 — Deterministic Engine Summary replaces generic EmptyStateCard */}
          <DeterministicEngineSummaryCard search={search} />

          {/* §5 / §3 — Why nothing qualified (narrative, no count duplication) */}
          <WhyNothingQualifiedSection search={search} />

          {/* §4 — Excluded Before Qualification (no CTA — primary CTA shown below) */}
          {hasExclusions && (
            <ExclusionSection
              groups={search.exclusionSummary ?? []}
              totalExcluded={search.excludedCount!}
              hideCtas
            />
          )}

          {/* §2 / §10 — Unavailable Candidates before Rejected; suppressed for data-only case */}
          {!isDataOnlyCase && (
            <UnavailableCandidatesSection search={search} question={question} hideCtas />
          )}

          {/* §3 / §10 — Rejected Candidates (true failures only) */}
          <RejectionSection />

          {/* §3 — Single primary CTA group (no duplication in sub-sections) */}
          <div className="pt-1">
            <CtaRow ctas={zeroQualifiedCtas(question)} testId="ctas-ranked-zero-qualified" />
          </div>
        </div>
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Normal (non-empty) result view
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-4" data-testid="section-ranked-trade-search">
      {/* §2 — Counts line */}
      <div className="text-xs text-muted-foreground" data-testid="text-ranked-counts">
        {rankedCountsLine(search)}
      </div>

      {/* §10 green — Qualified Candidates */}
      {search.candidates.length > 0 && (
        <div className="space-y-3">
          <div
            className="text-xs font-semibold uppercase tracking-wide text-emerald-400/80"
            data-testid="heading-ranked-top"
          >
            Qualified Candidates
          </div>
          {search.candidates.map((c) => (
            <QualifiedCard key={`${c.rank}-${c.symbol}`} c={c} />
          ))}
        </div>
      )}

      {/* §10 blue — Watch Candidates */}
      {search.watchCandidates.length > 0 && (
        <div className="space-y-3">
          <div
            className="text-xs font-semibold uppercase tracking-wide text-sky-400/80"
            data-testid="heading-ranked-watch"
          >
            Watch Candidates
          </div>
          {search.watchCandidates.map((w) => (
            <WatchCard key={w.symbol} w={w} />
          ))}
        </div>
      )}

      {/* §10 gray — Excluded */}
      {hasExclusions && (
        <ExclusionSection
          groups={search.exclusionSummary ?? []}
          totalExcluded={search.excludedCount!}
        />
      )}

      {/* §10 amber — Unavailable (before Rejected, per §8 ordering) */}
      <UnavailableCandidatesSection search={search} question={question} />

      {/* §10 red — Rejected (true failures only) */}
      <RejectionSection />
    </div>
  );
}
