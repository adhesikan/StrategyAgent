// Barrel export for Research Trade Card components
export { ResearchTradeCard } from "./research-trade-card";
export { StockTradeCard, deriveHoldingPeriod, resolveFieldState } from "./stock-trade-card";
export {
  OptionsTradeCard,
  shouldShowOptionsCard,
  deriveOptionsProbability,
  deriveOptionsExpirationTarget,
  deriveOptionsPaymentType,
  deriveOptionsMaxGain,
} from "./options-trade-card";
export {
  EvidenceCard,
  evidenceSignalLabel,
  evidenceSignalClass,
  evidenceSignalTextClass,
  computeEvidenceNumericScores,
} from "./evidence-card";
export { RiskCard, classifyWarning, groupWarnings } from "./risk-card";
export { ActionCard } from "./action-card";
export { CompactMarketContext, formatRegimeLabel, formatScanTime, deriveAlignment, sanitizeDataSource } from "./compact-market-context";
export { CompactOptionsOverview } from "./compact-options-overview";
export { CongressSummaryCard, congressActivityLabel, congressBadgeClass } from "./congress-summary-card";
export type {
  ResearchPackage,
  Candidate,
  LifecycleItem,
  LifecycleState,
  ScanHistoryEntry,
  MarketSnapshot,
  DashboardResponse,
  EvidenceStars,
  LIFECYCLE_BADGE,
  REGIME_LABEL,
} from "./types";
