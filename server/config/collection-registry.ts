/**
 * Research Collection Registry — Sprint 2.5.1
 *
 * Defines all 25 system collections and their Opportunity Intelligence filters.
 * System collections are read-only, automatically populated from the
 * Opportunity Intelligence Engine (Sprint 2.5.0) — never store opportunity
 * data, only symbol references for user collections.
 *
 * To add a new system collection: add an entry to SYSTEM_COLLECTIONS and
 * re-run seedSystemCollections().
 */

import type { OpportunityFilterOptions, OpportunitySortOptions } from "../../shared/opportunity-intelligence-types";

// ---------------------------------------------------------------------------
// Filter types for system collection resolution
// ---------------------------------------------------------------------------

export type SystemCollectionFilterSpec =
  | { mode: "theme";           theme: string }
  | { mode: "opportunityType"; opportunityType: string }
  | { mode: "sector";          sector: string }
  | { mode: "topByScore";      limit: number }
  | { mode: "topByInstitutional"; limit: number }
  | { mode: "topByRecency";    limit: number }
  | { mode: "newOpportunities"; limit: number };

export interface SystemCollectionDefinition {
  systemKey:   string;
  name:        string;
  description: string;
  filterSpec:  SystemCollectionFilterSpec;
}

// ---------------------------------------------------------------------------
// Curated system collection definitions
// ---------------------------------------------------------------------------

export const SYSTEM_COLLECTIONS: SystemCollectionDefinition[] = [
  // ── Theme-based ──────────────────────────────────────────────────────────
  {
    systemKey:   "ai-infrastructure",
    name:        "AI Infrastructure",
    description: "Companies providing hardware, software, and networking infrastructure enabling AI model training and inference.",
    filterSpec:  { mode: "theme", theme: "AI Infrastructure" },
  },
  {
    systemKey:   "semiconductors",
    name:        "Semiconductors",
    description: "Designers and manufacturers of semiconductor chips, equipment, and related components.",
    filterSpec:  { mode: "theme", theme: "Semiconductors" },
  },
  {
    systemKey:   "memory",
    name:        "Memory",
    description: "Companies designing or manufacturing DRAM, NAND, and HBM memory products.",
    filterSpec:  { mode: "theme", theme: "Memory" },
  },
  {
    systemKey:   "networking",
    name:        "Networking",
    description: "Companies providing networking infrastructure, switching, and data-center interconnect.",
    filterSpec:  { mode: "theme", theme: "Networking" },
  },
  {
    systemKey:   "cybersecurity",
    name:        "Cybersecurity",
    description: "Companies providing security software, threat intelligence, and identity management.",
    filterSpec:  { mode: "theme", theme: "Cybersecurity" },
  },
  {
    systemKey:   "cloud",
    name:        "Cloud",
    description: "Companies providing cloud computing infrastructure, platforms, and software-as-a-service.",
    filterSpec:  { mode: "theme", theme: "Cloud" },
  },

  // ── Sector-based ─────────────────────────────────────────────────────────
  {
    systemKey:   "energy",
    name:        "Energy",
    description: "Research candidates operating in the Energy sector.",
    filterSpec:  { mode: "sector", sector: "Energy" },
  },
  {
    systemKey:   "healthcare",
    name:        "Healthcare",
    description: "Research candidates operating in the Healthcare sector.",
    filterSpec:  { mode: "sector", sector: "Healthcare" },
  },
  {
    systemKey:   "financials",
    name:        "Financials",
    description: "Research candidates operating in the Financials sector.",
    filterSpec:  { mode: "sector", sector: "Financials" },
  },
  {
    systemKey:   "consumer",
    name:        "Consumer",
    description: "Research candidates operating in the Consumer sector.",
    filterSpec:  { mode: "sector", sector: "Consumer Discretionary" },
  },
  {
    systemKey:   "industrials",
    name:        "Industrials",
    description: "Research candidates operating in the Industrials sector.",
    filterSpec:  { mode: "sector", sector: "Industrials" },
  },

  // ── Strategy / opportunity type ──────────────────────────────────────────
  {
    systemKey:   "dividend",
    name:        "Dividend",
    description: "Dividend-focused research candidates with income-generating characteristics.",
    filterSpec:  { mode: "opportunityType", opportunityType: "dividend" },
  },
  {
    systemKey:   "income",
    name:        "Income",
    description: "Income strategy research candidates suitable for yield-focused research.",
    filterSpec:  { mode: "opportunityType", opportunityType: "income" },
  },
  {
    systemKey:   "growth",
    name:        "Growth",
    description: "Growth research candidates with technical momentum and improving fundamentals.",
    filterSpec:  { mode: "opportunityType", opportunityType: "growth" },
  },
  {
    systemKey:   "momentum",
    name:        "Momentum",
    description: "Momentum research candidates demonstrating strong relative strength.",
    filterSpec:  { mode: "opportunityType", opportunityType: "momentum" },
  },
  {
    systemKey:   "value",
    name:        "Value",
    description: "Value research candidates with improving technical setups.",
    filterSpec:  { mode: "opportunityType", opportunityType: "value" },
  },
  {
    systemKey:   "etf",
    name:        "ETF",
    description: "Exchange-traded fund research candidates.",
    filterSpec:  { mode: "opportunityType", opportunityType: "etf" },
  },
  {
    systemKey:   "long-term-investments",
    name:        "Long-Term Investments",
    description: "Long-term investment research candidates with durable compounding characteristics.",
    filterSpec:  { mode: "opportunityType", opportunityType: "long_term_investment" },
  },
  {
    systemKey:   "swing-trading",
    name:        "Swing Trading",
    description: "Short-to-medium term swing trade research candidates.",
    filterSpec:  { mode: "opportunityType", opportunityType: "swing" },
  },
  {
    systemKey:   "covered-calls",
    name:        "Covered Calls",
    description: "Covered call research candidates suitable for income generation via options.",
    filterSpec:  { mode: "opportunityType", opportunityType: "covered_call" },
  },
  {
    systemKey:   "cash-secured-puts",
    name:        "Cash Secured Puts",
    description: "Cash-secured put research candidates for income-focused options strategies.",
    filterSpec:  { mode: "opportunityType", opportunityType: "cash_secured_put" },
  },

  // ── Dynamic / ranked ─────────────────────────────────────────────────────
  {
    systemKey:   "market-leaders",
    name:        "Market Leaders",
    description: "Research candidates ranked in the top tier by overall research score.",
    filterSpec:  { mode: "topByScore", limit: 20 },
  },
  {
    systemKey:   "recently-improved",
    name:        "Recently Improved",
    description: "Research candidates with the most recent score improvements.",
    filterSpec:  { mode: "topByRecency", limit: 20 },
  },
  {
    systemKey:   "institutional-activity",
    name:        "Institutional Activity",
    description: "Research candidates with the highest institutional accumulation signals.",
    filterSpec:  { mode: "topByInstitutional", limit: 20 },
  },
  {
    systemKey:   "new-opportunities",
    name:        "New Opportunities",
    description: "Research candidates that newly appeared in the ranked opportunity set.",
    filterSpec:  { mode: "newOpportunities", limit: 20 },
  },
];

export function getSystemCollection(systemKey: string): SystemCollectionDefinition | undefined {
  return SYSTEM_COLLECTIONS.find(c => c.systemKey === systemKey);
}

// ---------------------------------------------------------------------------
// Convert a filter spec to OpportunityFilterOptions (for getOpportunityIntelligence)
// ---------------------------------------------------------------------------

export function filterSpecToOptions(
  spec: SystemCollectionFilterSpec,
): OpportunityFilterOptions {
  switch (spec.mode) {
    case "theme":           return { theme: [spec.theme] };
    case "opportunityType": return { opportunityType: [spec.opportunityType as any] };
    case "sector":          return { sector: [spec.sector] };
    case "topByScore":
    case "topByInstitutional":
    case "topByRecency":
    case "newOpportunities":
      return {}; // No filter — handled by sort + limit in the service
    default:                return {};
  }
}

export function filterSpecToSort(
  spec: SystemCollectionFilterSpec,
): OpportunitySortOptions | undefined {
  switch (spec.mode) {
    case "topByScore":        return { field: "researchScore",      direction: "desc" };
    case "topByInstitutional": return { field: "institutionalScore", direction: "desc" };
    case "topByRecency":      return { field: "lastUpdated",         direction: "desc" };
    case "newOpportunities":  return { field: "lastUpdated",         direction: "desc" };
    default:                  return undefined;
  }
}

export function filterSpecLimit(spec: SystemCollectionFilterSpec): number | undefined {
  switch (spec.mode) {
    case "topByScore":
    case "topByInstitutional":
    case "topByRecency":
    case "newOpportunities":
      return spec.limit;
    default:
      return undefined;
  }
}
