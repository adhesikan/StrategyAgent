// WorkspaceNav — sticky section navigation for the AI Trading Workspace.
//
// Sprint 2.2.3 / Scroll Regression Fix:
//
// Root causes fixed:
//   1. activeBtnRef.scrollIntoView() was scrolling the page — replaced with
//      manual scrollLeft manipulation on the nav element only.
//   2. findActiveSectionId returned the FIRST visible section; now returns the
//      LAST visible section (the one we've most recently scrolled into).
//   3. IntersectionObserver replaced with scroll-position detection so the
//      active pill always matches which section the top of the viewport is in,
//      regardless of the scroll container (document or nested PullToRefresh).
//   4. Click-to-scroll now does an immediate (optimistic) active-pill update
//      before scrollToSection fires, so feedback is instant.
//
// CSS contract:
//   Sections targeted by this nav must have `scroll-margin-top: 52px` (applied
//   globally via index.css rule `[id^="ws-"] { scroll-margin-top: 52px; }`).
//   scrollToSection() uses scrollIntoView({ block: "start" }) which respects
//   scroll-margin-top automatically.

import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Scroll-margin-top offset applied to workspace sections (via index.css).
 *  Exported so tests and other modules can use it as the detection threshold. */
export const WS_SCROLL_MARGIN_TOP = 52; // px

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceNavSection {
  /** Short nav identifier — used as the activeId value */
  id: string;
  /** Display label shown in the pill */
  label: string;
  /** DOM element id to scroll to (and to observe) */
  anchorId: string;
}

// ---------------------------------------------------------------------------
// WORKSPACE_SECTIONS — single source of truth for nav <-> DOM id mapping
// ---------------------------------------------------------------------------

export const WORKSPACE_NAV_SECTIONS: WorkspaceNavSection[] = [
  { id: "summary",    label: "Summary",        anchorId: "ws-summary" },
  { id: "lifecycle",  label: "What Changed",   anchorId: "ws-lifecycle" },
  { id: "decision",   label: "Decision",       anchorId: "ws-decision" },
  { id: "evidence",   label: "Evidence",       anchorId: "ws-evidence" },
  { id: "stock-plan", label: "Trade Planning", anchorId: "ws-stock-plan" },
  { id: "live",       label: "Live Contracts", anchorId: "ws-live-contracts" },
  { id: "risk",       label: "Risk",           anchorId: "ws-risk" },
  { id: "congress",   label: "Congress / News",anchorId: "ws-congress-news" },
  { id: "ask",        label: "Ask VCP AI",     anchorId: "ws-ask-ai" },
  { id: "instatrade", label: "InstaTrade™",    anchorId: "ws-instatrade" },
  { id: "history",    label: "Scan History",   anchorId: "ws-scan-history" },
];

// ---------------------------------------------------------------------------
// Pure helpers — exported for testing (no DOM dependency)
// ---------------------------------------------------------------------------

/**
 * Given a set of currently-visible section anchorIds, return the active nav
 * section id.
 *
 * Returns the LAST section in DOM order whose anchorId is in visibleIds.
 * "Last" = furthest down the page = the section we've most recently scrolled
 * into. Falls back to the first section if nothing is visible (user is above
 * all sections).
 *
 * This is kept as a pure helper for testing; the actual runtime hook uses
 * getBoundingClientRect-based detection (see useActiveSection).
 */
export function findActiveSectionId(
  sections: WorkspaceNavSection[],
  visibleIds: Set<string>,
): string {
  let result = "";
  for (const section of sections) {
    if (visibleIds.has(section.anchorId)) {
      result = section.id; // keep updating — last visible wins
    }
  }
  return result || (sections[0]?.id ?? "");
}

// ---------------------------------------------------------------------------
// scrollToSection — exported pure scroll helper
// ---------------------------------------------------------------------------

/**
 * Scroll the page so that the section with the given anchorId is visible.
 *
 * Uses scrollIntoView({block:"start"}) which respects `scroll-margin-top` on
 * the target element. Works regardless of whether the document or a nested
 * container (e.g. PullToRefresh) is the scroll container.
 */
export function scrollToSection(
  anchorId: string,
  prefersReducedMotion: boolean,
): void {
  const el = document.getElementById(anchorId);
  if (!el) return;
  el.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "start",
  });
}

// ---------------------------------------------------------------------------
// useActiveSection — scroll-position based active-section detection
// ---------------------------------------------------------------------------

/**
 * Returns [activeId, setActiveId].
 *
 * Actively tracks which workspace section is at the top of the viewport using
 * getBoundingClientRect on scroll events (throttled via requestAnimationFrame).
 * Listens on BOTH window and the nearest scrollable ancestor of the first
 * section element to handle document-scroll and nested-container-scroll apps.
 *
 * Algorithm: iterate sections in DOM order; the LAST section whose top edge is
 * at or above (WS_SCROLL_MARGIN_TOP + 8)px from the top of the viewport is
 * considered active. This naturally reads as "the section I'm currently in".
 */
export function useActiveSection(
  sections: WorkspaceNavSection[],
): [string, React.Dispatch<React.SetStateAction<string>>] {
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? "");
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (sections.length === 0) return;

    // Detection threshold: a section is "entered" when its top edge is at or
    // above this offset from the top of the viewport.
    const THRESHOLD = WS_SCROLL_MARGIN_TOP + 8;

    const update = () => {
      let current = sections[0]?.id ?? "";
      for (const section of sections) {
        const el = document.getElementById(section.anchorId);
        if (el) {
          const top = el.getBoundingClientRect().top;
          if (top <= THRESHOLD) {
            current = section.id; // keep going — last one below threshold wins
          }
        }
      }
      setActiveId(current);
    };

    const onScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(update);
    };

    // Listen on window (covers document scrolling and most setups).
    window.addEventListener("scroll", onScroll, { passive: true });

    // Also find and listen on the nearest scrollable ancestor (for PullToRefresh
    // and other nested overflow:auto containers).
    let scrollParent: Element | null = null;
    const firstEl = document.getElementById(sections[0]?.anchorId ?? "");
    if (firstEl) {
      let candidate: HTMLElement | null = firstEl.parentElement;
      while (candidate) {
        const { overflow, overflowY } = window.getComputedStyle(candidate);
        if (/auto|scroll/.test(`${overflow}${overflowY}`)) {
          scrollParent = candidate;
          break;
        }
        candidate = candidate.parentElement;
      }
    }

    if (
      scrollParent &&
      scrollParent !== document.body &&
      scrollParent !== document.documentElement
    ) {
      scrollParent.addEventListener("scroll", onScroll, { passive: true });
    }

    update(); // run immediately for initial state

    return () => {
      window.removeEventListener("scroll", onScroll);
      if (scrollParent) scrollParent.removeEventListener("scroll", onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [sections]);

  return [activeId, setActiveId];
}

// ---------------------------------------------------------------------------
// WorkspaceNav component
// ---------------------------------------------------------------------------

interface WorkspaceNavProps {
  sections?: WorkspaceNavSection[];
  className?: string;
}

export function WorkspaceNav({
  sections = WORKSPACE_NAV_SECTIONS,
  className,
}: WorkspaceNavProps) {
  const [activeId, setActiveId] = useActiveSection(sections);
  const navRef = useRef<HTMLElement>(null);

  const prefersReducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  // Auto-scroll the nav BAR to keep the active pill in view.
  // Uses manual scrollLeft manipulation instead of scrollIntoView() to avoid
  // accidentally scrolling the page or other ancestors.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const activeBtn = nav.querySelector<HTMLButtonElement>(
      `[data-testid="ws-nav-btn-${activeId}"]`,
    );
    if (!activeBtn) return;

    const navRect = nav.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    const scrollLeft = nav.scrollLeft;

    // Button position relative to nav scroll origin
    const btnLeft = btnRect.left - navRect.left + scrollLeft;
    const btnRight = btnLeft + btnRect.width;
    const navWidth = nav.clientWidth;
    const PADDING = 8;

    if (btnLeft < scrollLeft + PADDING) {
      // Button is off the left edge — scroll left
      nav.scrollTo({
        left: btnLeft - PADDING,
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });
    } else if (btnRight > scrollLeft + navWidth - PADDING) {
      // Button is off the right edge — scroll right
      nav.scrollTo({
        left: btnRight - navWidth + PADDING,
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });
    }
  }, [activeId, prefersReducedMotion]);

  // Click: immediate optimistic active update + scroll to section
  const handleClick = useCallback(
    (anchorId: string, sectionId: string) => {
      setActiveId(sectionId); // immediate feedback
      scrollToSection(anchorId, prefersReducedMotion);
    },
    [prefersReducedMotion, setActiveId],
  );

  // Keyboard: left/right arrows move focus between pills
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>, idx: number) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const nextIdx = (idx + 1) % sections.length;
        const btn = navRef.current?.querySelectorAll<HTMLButtonElement>("button")[nextIdx];
        btn?.focus();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        const prevIdx = (idx - 1 + sections.length) % sections.length;
        const btn = navRef.current?.querySelectorAll<HTMLButtonElement>("button")[prevIdx];
        btn?.focus();
      }
    },
    [sections],
  );

  return (
    <nav
      ref={navRef}
      aria-label="Workspace section navigation"
      className={cn(
        // Sticky below the tab bar within the scroll container; covers content
        // as the user scrolls. Does NOT use position:fixed so it doesn't create
        // a second scroll container.
        "sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border/30",
        // Horizontal scrolling for narrow viewports — does NOT intercept
        // vertical wheel events on most browsers.
        "overflow-x-auto scrollbar-none",
        // Negative horizontal margins let the nav span the full content width
        // without the parent's padding. Pointer events apply only to the nav.
        "-mx-4 md:-mx-8 px-4 md:px-8",
        className,
      )}
      data-testid="workspace-nav"
      // Prevent the nav's horizontal overflow-x from suppressing vertical scroll
      // on browsers that use overscroll-behavior for this.
      style={{ overscrollBehaviorX: "contain" }}
    >
      <div className="flex items-center gap-1 py-1.5 min-w-max">
        {sections.map((section, idx) => {
          const isActive = activeId === section.id;
          return (
            <button
              key={section.id}
              type="button"
              role="link"
              aria-label={`Scroll to ${section.label} section`}
              aria-current={isActive ? "location" : undefined}
              onClick={() => handleClick(section.anchorId, section.id)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              className={cn(
                "shrink-0 rounded px-2.5 py-1 text-[11px] font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                isActive
                  ? "bg-primary/10 text-primary border border-primary/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/40",
              )}
              data-testid={`ws-nav-btn-${section.id}`}
            >
              {section.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
