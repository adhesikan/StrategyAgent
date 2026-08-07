// Pure display helpers for the Opportunity Ranking Engine (Sprint 2.2.8).
// Extracted from the dashboard component so they can be unit-tested without DOM.

export type ScoreCategory = "Top Growth" | "Income" | "Watch" | "Avoid";
export type ScoreConfidence = "high" | "medium" | "low";
export type ChangeDirection = "upgraded" | "downgraded" | "new" | "moved";

// ---------------------------------------------------------------------------
// Score colouring
// ---------------------------------------------------------------------------

/** Tailwind text-colour class for a 0-100 score. */
export function getScoreColorClass(score: number): string {
  if (score >= 80) return "text-emerald-400";
  if (score >= 60) return "text-sky-400";
  if (score >= 40) return "text-amber-400";
  return "text-rose-400";
}

/** Tailwind bg-colour class for the score progress bar fill. */
export function getScoreBarClass(score: number): string {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 60) return "bg-sky-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-rose-500";
}

// ---------------------------------------------------------------------------
// Relative timestamp
// ---------------------------------------------------------------------------

/**
 * "4 minutes ago", "1 hour ago", "2 days ago", etc.
 * Pass `now` explicitly in tests for determinism.
 */
export function formatRelativeTime(dateStr: string, now = new Date()): string {
  const diffMs = now.getTime() - new Date(dateStr).getTime();
  if (diffMs < 0 || diffMs < 30_000) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins === 1) return "1 minute ago";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? "s" : ""} ago`;
}

// ---------------------------------------------------------------------------
// Category badge
// ---------------------------------------------------------------------------

/** Short display label for a ranked category. */
export function getCategoryLabel(category: ScoreCategory | string): string {
  switch (category) {
    case "Top Growth": return "Growth";
    case "Income":     return "Income";
    case "Watch":      return "Watch";
    case "Avoid":      return "Avoid";
    default:           return category;
  }
}

/** Tailwind class for a category badge (border + text + bg). */
export function getCategoryBadgeClass(category: ScoreCategory | string): string {
  switch (category) {
    case "Top Growth": return "text-emerald-300 border-emerald-500/40 bg-emerald-500/10";
    case "Income":     return "text-sky-300 border-sky-500/40 bg-sky-500/10";
    case "Watch":      return "text-amber-300 border-amber-500/40 bg-amber-500/10";
    case "Avoid":      return "text-rose-300 border-rose-500/40 bg-rose-500/10";
    default:           return "text-muted-foreground border-border";
  }
}

// ---------------------------------------------------------------------------
// Change direction
// ---------------------------------------------------------------------------

/** Symbol + label for a ranking change direction. */
export function getChangeDisplay(direction: ChangeDirection | string): { symbol: string; label: string } {
  switch (direction) {
    case "new":        return { symbol: "★", label: "New" };
    case "upgraded":   return { symbol: "↑", label: "Upgraded" };
    case "downgraded": return { symbol: "↓", label: "Downgraded" };
    case "moved":      return { symbol: "→", label: "Moved" };
    default:           return { symbol: "•", label: String(direction) };
  }
}

/** Tailwind class for a change direction badge. */
export function getChangeBadgeClass(direction: ChangeDirection | string): string {
  switch (direction) {
    case "new":        return "text-emerald-300 border-emerald-500/40 bg-emerald-500/10";
    case "upgraded":   return "text-sky-300 border-sky-500/40 bg-sky-500/10";
    case "downgraded": return "text-rose-300 border-rose-500/40 bg-rose-500/10";
    case "moved":      return "text-amber-300 border-amber-500/40 bg-amber-500/10";
    default:           return "text-muted-foreground border-border";
  }
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

/** Tailwind class for a confidence badge. */
export function getConfidenceBadgeClass(confidence: ScoreConfidence | string): string {
  switch (confidence) {
    case "high":   return "text-emerald-300 border-emerald-500/30 bg-emerald-500/5";
    case "medium": return "text-amber-300 border-amber-500/30 bg-amber-500/5";
    case "low":    return "text-rose-300 border-rose-500/30 bg-rose-500/5";
    default:       return "text-muted-foreground border-border";
  }
}
