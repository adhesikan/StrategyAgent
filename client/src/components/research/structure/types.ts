// Trade Structure Engine — shared types.
// All types are pure data shapes; no logic here.
// Re-exports the upstream research types for convenience.

export type { ResearchPackage, EvidenceStars, MarketSnapshot, Candidate } from "../types";

// ---------------------------------------------------------------------------
// Stock structure
// ---------------------------------------------------------------------------

export type StockStructureType =
  | "breakout-entry"
  | "pullback-entry"
  | "swing-position"
  | "position-trade"
  | "long-stock";

export interface StockStructure {
  type: StockStructureType;
  label: string;
  description: string;
  capitalEfficiency: string;
  riskProfile: string;
  holdingHorizon: string;
  advantages: string[];
  disadvantages: string[];
  whyFits: string[];
}

// ---------------------------------------------------------------------------
// Options structure
// ---------------------------------------------------------------------------

export type OptionsStructureName =
  | "long-call"
  | "bull-call-spread"
  | "bull-put-spread"
  | "cash-secured-put"
  | "covered-call"
  | "protective-put"
  | "diagonal"
  | "iron-condor"
  | "call-debit-spread"
  | "call-credit-spread";

export interface OptionsStructure {
  name: OptionsStructureName;
  label: string;
  preferredDTE: string;      // e.g. "30–45 DTE"
  strikeGuidance: string;    // e.g. "Near ATM"
  reason: string;
  capitalEfficiency: string;
  riskProfile: string;       // "Defined" | "Undefined" | "Limited"
  timeDecay: string;         // "Works against" | "Works for" | "Neutral"
  marketOutlook: string;
  isDefinedRisk: boolean;
  isBestOverall: boolean;
  isIncome: boolean;
  isConservative: boolean;
}

// ---------------------------------------------------------------------------
// Income / conservative overlays (wrappers for display)
// ---------------------------------------------------------------------------

export interface IncomeStructure extends OptionsStructure {
  incomeNote: string;
}

export interface ConservativeStructure extends OptionsStructure {
  conservativeNote: string;
}

// ---------------------------------------------------------------------------
// Trade comparison
// ---------------------------------------------------------------------------

export type ComparisonCategory =
  | "best-overall"
  | "best-stock"
  | "income-alternative"
  | "conservative";

export interface StructureComparison {
  category: ComparisonCategory;
  categoryLabel: string;
  structureName: string;   // display label, e.g. "Bull Call Spread"
  confidence: number;      // 0–100
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

export interface StructureRiskProfile {
  maxRisk: string;
  assignmentRisk: string | null;
  timeDecay: string;
  gapRisk: string;
  volatilitySensitivity: string;
  liquidityNote: string;
  earlyAssignment: string | null;
}
