// Research Title and Tag Generator — Sprint 5.4C
//
// Deterministic title and tag suggestions for ResearchEvidenceRecords.
// No OpenAI involvement. Users may edit title and tags after saving.
// Language follows spec §13 product vocabulary (no advisory language).

import type { ResearchEvidenceRecord, ResearchDomain } from "./research-save-handle";

// ---------------------------------------------------------------------------
// Title templates per domain (spec §11 examples)
// ---------------------------------------------------------------------------

const DOMAIN_LABELS: Record<ResearchDomain, string> = {
  SYMBOL_ANALYSIS: "Symbol Analysis",
  TRADE_RESEARCH: "Trade Research",
  MARKET_OPPORTUNITY_SEARCH: "Opportunity Search",
  PORTFOLIO_GOAL_RESEARCH: "Portfolio Goal Research",
  PORTFOLIO_IMPACT: "Portfolio Impact",
  OPTIONS_RESEARCH: "Options Research",
};

const DIRECTION_LABELS: Record<string, string> = {
  bullish: "Bullish",
  bearish: "Bearish",
  neutral: "Neutral",
  either: "Directional",
};

/** Format a Date as "YYYY-MM-DD" in UTC. */
function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Generate a deterministic title suggestion.
 * Pattern: "[Symbol/Direction/Context] [Domain Label] — [Date]"
 * Examples from spec §11:
 *   "BA Symbol Analysis — 2026-08-04"
 *   "NVDA Trade Research — 2026-08-04"
 *   "Bullish Market Opportunity Search — 2026-08-04"
 *   "Portfolio Goal Research — Defined Risk — 2026-08-04"
 */
export function generateTitleSuggestion(evidence: ResearchEvidenceRecord): string {
  const date = formatDate(new Date(evidence.generatedAt));
  const domainLabel = DOMAIN_LABELS[evidence.domain] ?? evidence.domain;

  // Symbol-specific: use the symbol as prefix
  if (evidence.symbol) {
    return `${evidence.symbol.toUpperCase()} ${domainLabel} — ${date}`;
  }

  // Direction-qualified (market search)
  if (evidence.direction && evidence.domain === "MARKET_OPPORTUNITY_SEARCH") {
    const dirLabel = DIRECTION_LABELS[evidence.direction.toLowerCase()] ?? evidence.direction;
    return `${dirLabel} ${domainLabel} — ${date}`;
  }

  // Portfolio goal: add strategy qualifier if present
  if (evidence.domain === "PORTFOLIO_GOAL_RESEARCH") {
    if (evidence.strategyDisplayName) {
      return `${domainLabel} — ${evidence.strategyDisplayName} — ${date}`;
    }
    if (evidence.strategy) {
      return `${domainLabel} — ${evidence.strategy} — ${date}`;
    }
    return `${domainLabel} — ${date}`;
  }

  // Multi-symbol
  if (evidence.symbols && evidence.symbols.length > 0) {
    const prefix = evidence.symbols.slice(0, 3).join(", ");
    return `${prefix} ${domainLabel} — ${date}`;
  }

  // Default
  return `${domainLabel} — ${date}`;
}

/**
 * Generate suggested tags from structured fields (spec §11).
 * Tags are lowercase, kebab-case, deduped.
 */
export function generateTagSuggestions(evidence: ResearchEvidenceRecord): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();

  function add(tag: string): void {
    const normalized = tag.toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 50);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      tags.push(normalized);
    }
  }

  add(evidence.domain);

  if (evidence.symbol) add(evidence.symbol);
  if (evidence.symbols) evidence.symbols.slice(0, 5).forEach(add);

  if (evidence.strategy) add(evidence.strategy);
  else if (evidence.strategyDisplayName) add(evidence.strategyDisplayName);

  if (evidence.direction) add(evidence.direction);

  if (evidence.instrument) add(evidence.instrument);

  // Confidence level
  if (evidence.confidence !== "none") add(`confidence-${evidence.confidence}`);

  // Data quality
  if (evidence.dataQuality?.estimated) add("estimated-data");
  if (evidence.dataQuality?.stale) add("stale-data");

  return tags.slice(0, 10);
}
