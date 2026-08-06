// WorkspaceNav — sticky section navigation for the AI Trading Workspace.
//
// Desktop: horizontal sticky pill bar below the tabs.
// Mobile: compact horizontal scrollable strip.
// Tracks the active section via IntersectionObserver.
//
// Requirements:
// - keyboard accessible (arrow keys, Enter/Space)
// - reduced-motion support
// - no route change — scroll-to-anchor only
// - ARIA labels on all controls

import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceNavSection {
  id: string;        // matches the HTML element id (e.g. "ws-lifecycle")
  label: string;     // short display label
  anchorId: string;  // the DOM element to scroll to
}

// ---------------------------------------------------------------------------
// Default workspace sections — exported so tests and the page can import them
// ---------------------------------------------------------------------------

export const WORKSPACE_NAV_SECTIONS: WorkspaceNavSection[] = [
  { id: "summary",      label: "Summary",        anchorId: "ws-summary" },
  { id: "lifecycle",    label: "What Changed",   anchorId: "ws-lifecycle" },
  { id: "decision",     label: "Decision",       anchorId: "ws-decision" },
  { id: "evidence",     label: "Evidence",       anchorId: "ws-evidence" },
  { id: "stock-plan",   label: "Trade Planning", anchorId: "ws-stock-plan" },
  { id: "live",         label: "Live Contracts", anchorId: "ws-live-contracts" },
  { id: "risk",         label: "Risk",           anchorId: "ws-risk" },
  { id: "congress",     label: "Congress / News",anchorId: "ws-congress-news" },
  { id: "ask",          label: "Ask VCP AI",     anchorId: "ws-ask-ai" },
  { id: "instatrade",   label: "InstaTrade™",    anchorId: "ws-instatrade" },
  { id: "history",      label: "Scan History",   anchorId: "ws-scan-history" },
];

// ---------------------------------------------------------------------------
// Pure helper: find the active section based on which anchor IDs are visible
// ---------------------------------------------------------------------------

export function findActiveSectionId(
  sections: WorkspaceNavSection[],
  visibleIds: Set<string>,
): string {
  // Return the first section (in DOM order) that is currently visible
  for (const section of sections) {
    if (visibleIds.has(section.anchorId)) return section.id;
  }
  // Fall back to first section if nothing is visible (e.g. above all sections)
  return sections[0]?.id ?? "";
}

// ---------------------------------------------------------------------------
// useActiveSection hook — IntersectionObserver based
// ---------------------------------------------------------------------------

export function useActiveSection(
  sections: WorkspaceNavSection[],
): string {
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? "");
  const visibleRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const threshold = 0.2;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const elementId = entry.target.id;
          if (entry.isIntersecting) {
            visibleRef.current.add(elementId);
          } else {
            visibleRef.current.delete(elementId);
          }
        });
        const next = findActiveSectionId(sections, visibleRef.current);
        if (next) setActiveId(next);
      },
      { threshold, rootMargin: "0px 0px -60% 0px" },
    );

    // Observe all anchor elements
    sections.forEach((section) => {
      const el = document.getElementById(section.anchorId);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [sections]);

  return activeId;
}

// ---------------------------------------------------------------------------
// scrollToSection — pure scroll helper (exported for testing)
// ---------------------------------------------------------------------------

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
  const activeId = useActiveSection(sections);
  const navRef = useRef<HTMLElement>(null);
  const activeBtnRef = useRef<HTMLButtonElement>(null);
  const prefersReducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  // Auto-scroll the nav bar to keep the active pill visible
  useEffect(() => {
    if (activeBtnRef.current && navRef.current) {
      activeBtnRef.current.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [activeId, prefersReducedMotion]);

  const handleClick = useCallback(
    (anchorId: string) => {
      scrollToSection(anchorId, prefersReducedMotion);
    },
    [prefersReducedMotion],
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
        // Sticky below tab bar; sits above content
        "sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border/30",
        "overflow-x-auto scrollbar-none",
        "-mx-4 md:-mx-8 px-4 md:px-8",
        className,
      )}
      data-testid="workspace-nav"
    >
      <div className="flex items-center gap-1 py-1.5 min-w-max">
        {sections.map((section, idx) => {
          const isActive = activeId === section.id;
          return (
            <button
              key={section.id}
              ref={isActive ? activeBtnRef : undefined}
              type="button"
              role="link"
              aria-label={`Scroll to ${section.label} section`}
              aria-current={isActive ? "location" : undefined}
              onClick={() => handleClick(section.anchorId)}
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
