/**
 * ScoreExplanationModal
 *
 * "Understanding Research Scores" modal — populated entirely from the
 * central Research Glossary (shared/research-glossary.ts).
 *
 * Entry points:
 *   - "How are scores calculated?" link on the dashboard opportunity header
 *   - "Understanding research scores" in the Opportunity Workspace
 *   - Research Hub header
 *   - Research Workspace header
 *
 * Accessibility:
 *   - Focus trap (Radix Dialog handles this)
 *   - Escape closes (Radix Dialog)
 *   - Restore focus on close (Radix Dialog)
 *   - Semantic heading hierarchy (h2, h3)
 *   - Screen-reader friendly via aria-labelledby on Dialog
 *
 * Mobile:
 *   - Responsive ScrollArea — no horizontal overflow
 *   - Full-screen on narrow viewports via max-h + overflow
 *
 * Do NOT add score definitions inline here — always read from glossary.
 */

import { BookOpen, TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  getScoreGlossaryEntries,
  getCandidateTypeEntries,
  getGlossaryByCategory,
  type ResearchGlossaryEntry,
} from "@shared/research-glossary";

// ---------------------------------------------------------------------------
// Section renderer
// ---------------------------------------------------------------------------

function GlossaryEntryRow({ entry }: { entry: ResearchGlossaryEntry }) {
  return (
    <div className="space-y-1.5 py-3 border-b border-border/30 last:border-0">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-foreground">{entry.label}</h3>
        {entry.shortLabel && entry.shortLabel !== entry.label && (
          <Badge variant="outline" className="text-[10px] font-mono">
            {entry.shortLabel}
          </Badge>
        )}
        {entry.higherIsBetter === true && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-400">
            <TrendingUp className="h-2.5 w-2.5" aria-hidden="true" />
            Higher is better
          </span>
        )}
        {entry.higherIsBetter === false && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-rose-400">
            <TrendingDown className="h-2.5 w-2.5" aria-hidden="true" />
            Lower is better
          </span>
        )}
      </div>

      <p className="text-sm text-muted-foreground leading-relaxed">
        {entry.fullDefinition}
      </p>

      {entry.methodologySummary && (
        <p className="text-xs text-muted-foreground/70 leading-relaxed italic">
          <span className="not-italic font-medium text-muted-foreground">How it's computed: </span>
          {entry.methodologySummary}
        </p>
      )}

      {entry.interpretation && (
        <p className="text-xs leading-relaxed text-sky-300/80">
          <span className="font-medium text-sky-300">How to read it: </span>
          {entry.interpretation}
        </p>
      )}

      {entry.caution && (
        <p className="text-xs text-amber-400/80 leading-relaxed">
          ⚠ {entry.caution}
        </p>
      )}
    </div>
  );
}

function SectionBlock({
  title,
  entries,
}: {
  title: string;
  entries: ResearchGlossaryEntry[];
}) {
  if (entries.length === 0) return null;
  return (
    <section aria-labelledby={`section-${title.replace(/\s+/g, "-").toLowerCase()}`}>
      <h2
        id={`section-${title.replace(/\s+/g, "-").toLowerCase()}`}
        className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1 mt-4 first:mt-0"
      >
        {title}
      </h2>
      {entries.map((e) => (
        <GlossaryEntryRow key={e.key} entry={e} />
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main modal content
// ---------------------------------------------------------------------------

function ModalContent() {
  const scoreEntries = getScoreGlossaryEntries();
  const confidenceEntries = getGlossaryByCategory("confidence");
  const evidenceEntries = getGlossaryByCategory("evidence");
  const marketEntries = getGlossaryByCategory("market_context");
  const dataQualityEntries = getGlossaryByCategory("data_quality");
  const candidateEntries = getCandidateTypeEntries();

  return (
    <ScrollArea className="h-[calc(85vh-6rem)] pr-3" type="auto">
      <div className="space-y-0 pb-4">
        <SectionBlock title="Research Scores" entries={scoreEntries} />
        <SectionBlock title="Evidence Confidence" entries={confidenceEntries} />
        <SectionBlock title="Research Evidence" entries={evidenceEntries} />
        <SectionBlock title="Market Context" entries={marketEntries} />
        <SectionBlock title="Data Quality" entries={dataQualityEntries} />
        <SectionBlock title="Research Candidate Types" entries={candidateEntries} />
      </div>
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------
// Modal footer disclaimer
// ---------------------------------------------------------------------------

function ModalFooter() {
  return (
    <div className="mt-4 pt-3 border-t border-border/30">
      <p className="text-xs text-muted-foreground/70 leading-relaxed text-center">
        Research scores organize available evidence. They are not predictions of
        future performance and do not constitute investment advice.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

export interface ScoreExplanationModalProps {
  /** Trigger element. If omitted, a default "How are scores calculated?" link is rendered. */
  trigger?: React.ReactNode;
  /** Additional className on the trigger wrapper. */
  className?: string;
}

export function ScoreExplanationModal({
  trigger,
  className,
}: ScoreExplanationModalProps) {
  const defaultTrigger = (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "h-auto py-0.5 px-1.5 text-[11px] text-muted-foreground/70 hover:text-muted-foreground gap-1",
        className,
      )}
      aria-label="Open research score explanations"
      data-testid="btn-score-explanation-modal"
    >
      <BookOpen className="h-3 w-3" aria-hidden="true" />
      How are scores calculated?
    </Button>
  );

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? defaultTrigger}
      </DialogTrigger>

      <DialogContent
        className="max-w-xl w-full"
        aria-labelledby="score-modal-title"
        data-testid="score-explanation-modal"
      >
        <DialogHeader>
          <DialogTitle id="score-modal-title" className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4 text-sky-400" aria-hidden="true" />
            Understanding Research Scores
          </DialogTitle>
        </DialogHeader>

        <Separator />

        <ModalContent />

        <ModalFooter />
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Convenience: inline "Understanding research scores" link variant
// ---------------------------------------------------------------------------

export function UnderstandingScoresLink({ className }: { className?: string }) {
  return (
    <ScoreExplanationModal
      trigger={
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-auto py-0.5 px-1.5 text-[11px] text-muted-foreground/70 hover:text-muted-foreground gap-1",
            className,
          )}
          data-testid="btn-understanding-scores-link"
        >
          <BookOpen className="h-3 w-3" aria-hidden="true" />
          Understanding research scores
        </Button>
      }
    />
  );
}
