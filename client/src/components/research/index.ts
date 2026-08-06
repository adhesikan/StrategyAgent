// Barrel export for Research Trade Card components
export { ResearchTradeCard } from "./research-trade-card";
export { StockTradeCard, deriveHoldingPeriod } from "./stock-trade-card";
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
} from "./evidence-card";
export { RiskCard } from "./risk-card";
export { ActionCard } from "./action-card";
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
