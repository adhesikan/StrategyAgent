/**
 * ResearchDefinitionTooltip
 *
 * Renders a tooltip that explains a research term using the central
 * Research Glossary (shared/research-glossary.ts).
 *
 * Usage:
 *   <ResearchDefinitionTooltip term="technical_score">
 *     Tech
 *   </ResearchDefinitionTooltip>
 *
 *   <ResearchDefinitionTooltip term="evidence_confidence" />
 *   // ↑ renders a HelpCircle icon when no children supplied
 *
 * Accessibility:
 *   - Trigger is a <button> (keyboard-focusable by default)
 *   - Enter/Space activate via button default behavior + Radix tooltip
 *   - Escape closes via Radix TooltipPrimitive
 *   - aria-label on trigger describes the definition action
 *   - aria-describedby wired through Radix primitives
 *   - Touch-friendly: tooltip opens on focus (tap-to-focus on mobile)
 *
 * Mobile:
 *   - onClick toggles open state for touch users who cannot hover
 *   - No horizontal overflow: content max-w-xs with word-wrap
 *
 * Unknown key: renders children as-is with no tooltip (graceful degradation).
 * Do NOT hard-code definitions here — always reference glossary keys.
 */

import { useState, useCallback } from "react";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getGlossaryEntry } from "@shared/research-glossary";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ResearchDefinitionTooltipProps {
  /** Glossary key from shared/research-glossary.ts (e.g. "technical_score"). */
  term: string;
  /**
   * Element(s) to wrap with the tooltip trigger.
   * When omitted, a small HelpCircle icon is rendered.
   */
  children?: React.ReactNode;
  /** Additional className on the trigger button. */
  className?: string;
  /** Tooltip placement relative to the trigger. Default: "top". */
  side?: "top" | "bottom" | "left" | "right";
  /** Whether to show caution text. Default: true. */
  showCaution?: boolean;
  /** Tooltip open delay in ms. Default: 150. */
  delayDuration?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ResearchDefinitionTooltip({
  term,
  children,
  className,
  side = "top",
  showCaution = true,
  delayDuration = 150,
}: ResearchDefinitionTooltipProps) {
  const entry = getGlossaryEntry(term);

  // Touch-support state — clicking the trigger toggles open on mobile.
  const [open, setOpen] = useState(false);
  const handleClick = useCallback(() => setOpen((v) => !v), []);
  const handleOpenChange = useCallback((v: boolean) => setOpen(v), []);

  // Graceful degradation — unknown key renders children with no tooltip.
  if (!entry) {
    return <>{children}</>;
  }

  return (
    <TooltipProvider delayDuration={delayDuration}>
      <Tooltip open={open} onOpenChange={handleOpenChange}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleClick}
            aria-label={`What is ${entry.label}?`}
            className={cn(
              // Inline so it doesn't disrupt surrounding flow.
              "inline-flex items-center gap-0.5",
              // Subtle dotted underline to hint interactivity.
              children
                ? "underline decoration-dotted underline-offset-2 decoration-muted-foreground/50 cursor-help"
                : "cursor-help",
              // Focus ring for keyboard users.
              "rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              className,
            )}
            // Prevent button from inheriting unwanted styles from parent buttons/cards.
            style={{ background: "none", border: "none", padding: 0, font: "inherit" }}
          >
            {children ?? (
              <HelpCircle
                className="h-3 w-3 text-muted-foreground/70 shrink-0"
                aria-hidden="true"
              />
            )}
          </button>
        </TooltipTrigger>

        <TooltipContent
          side={side}
          className="max-w-xs z-[70] text-left"
          // Allow user to read and interact with tooltip content.
          onPointerDownOutside={() => setOpen(false)}
        >
          {/* Term label */}
          <p className="font-semibold text-xs mb-1">{entry.label}</p>

          {/* Short definition */}
          <p className="text-xs text-popover-foreground/90 leading-relaxed">
            {entry.shortDefinition}
          </p>

          {/* Score direction hint */}
          {entry.higherIsBetter !== undefined && (
            <p className="text-[10px] text-muted-foreground mt-1">
              {entry.higherIsBetter
                ? "↑ Higher is better"
                : "↓ Lower is better"}
            </p>
          )}

          {/* Compliance caution */}
          {showCaution && entry.caution && (
            <p className="text-[10px] text-amber-400/90 mt-1 border-t border-border/40 pt-1 leading-relaxed">
              {entry.caution}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Convenience: standalone help icon (no children)
// ---------------------------------------------------------------------------

/** A standalone question-mark icon that explains a glossary term. */
export function ResearchHelpIcon({
  term,
  className,
  side,
}: {
  term: string;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <ResearchDefinitionTooltip term={term} side={side} className={className} />
  );
}
