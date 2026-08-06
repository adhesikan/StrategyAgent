// ---------------------------------------------------------------------------
// Decision Engine types
// Used by all Research Decision Engine components.
// ---------------------------------------------------------------------------

import type { ResearchPackage, EvidenceStars, MarketSnapshot, Candidate } from "../types";
export type { ResearchPackage, EvidenceStars, MarketSnapshot, Candidate };

// Overall research thesis
export type Thesis = "bullish" | "neutral" | "bearish";

// Evidence alignment for each evidence section
export type EvidenceAlignment = "supports" | "neutral" | "weakens" | "unavailable";

// A single score component in the ScoreBreakdown
export interface ScoreComponent {
  id: string;
  label: string;
  score: number;       // 0–100
  available: boolean;  // false = N/A (no data source)
  source: string;      // human-readable source description
}

// A row in the QualificationSummary confirmations section
export interface QualificationConfirmation {
  id: string;
  label: string;
  status: "confirmed" | "partial" | "missing" | "unavailable";
  detail: string;
}

// An item in the Invalidation list
export interface InvalidationItem {
  type: "price" | "technical" | "fundamental" | "earnings" | "macro" | "sector";
  label: string;
  description: string;
  available: boolean;
}

// An improvement suggestion
export interface ImprovementItem {
  id: string;
  category: string;
  text: string;
}

// A warning item
export interface WarningItem {
  id: string;
  severity: "high" | "medium" | "low";
  text: string;
}

// Evidence section definition for SupportingEvidenceCard
export interface EvidenceSection {
  id: string;
  label: string;
  score: number;
  available: boolean;
  alignment: EvidenceAlignment;
  items: string[];   // supporting detail bullets
  gap?: string;      // what is missing or weakening
}
