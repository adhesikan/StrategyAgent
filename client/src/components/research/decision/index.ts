// Barrel export for Research Decision Engine components

export { ResearchDecisionEngine } from "./research-decision-engine";
export { ResearchDecisionCard, deriveThesis, buildThesisExplanation } from "./research-decision-card";
export { QualificationSummaryCard, buildQualificationConfirmations } from "./qualification-summary-card";
export {
  ScoreBreakdownCard,
  computeScoreComponents,
  computeTechnicalScore,
  computeMomentumScore,
  computeVolumeScore,
  computeRelativeStrengthScore,
  computeRegimeScore,
  computeFundamentalsScore,
  computeLiquidityScore,
  computeRiskScore,
} from "./score-breakdown-card";
export { SupportingEvidenceCard, classifyEvidenceAlignment, buildEvidenceSections } from "./supporting-evidence-card";
export { InvalidationCard, buildInvalidationItems } from "./invalidation-card";
export {
  CatalystTimelineCard,
  buildImprovementItems,
  buildWarningItems,
} from "./catalyst-timeline-card";

export type {
  Thesis,
  EvidenceAlignment,
  ScoreComponent,
  QualificationConfirmation,
  InvalidationItem,
  ImprovementItem,
  WarningItem,
  EvidenceSection,
} from "./types";
