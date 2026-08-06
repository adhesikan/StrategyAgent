// Trade Structure Engine — barrel exports.
// Consumed by opportunity-research.tsx (Trade Planning tab).

export { TradeStructureEngine } from "./trade-structure-engine";
export { TradeStructureCard } from "./trade-structure-card";
export { TradeComparisonCard, buildStructureComparisons } from "./trade-comparison-card";
export { StockStructureCard, deriveStockStructure } from "./stock-structure-card";
export { OptionsStructureCard, deriveOptionsStructures, deriveDTE, deriveStrikeGuidance } from "./options-structure-card";
export { TradeStructureReasonCard, buildStockStructureReason, buildOptionsStructureReason } from "./trade-structure-reason-card";
export { TradeStructureRiskCard, buildStockRiskProfile, buildOptionsRiskProfile } from "./trade-structure-risk-card";
export type {
  StockStructure,
  StockStructureType,
  OptionsStructure,
  OptionsStructureName,
  IncomeStructure,
  ConservativeStructure,
  StructureComparison,
  ComparisonCategory,
  StructureRiskProfile,
} from "./types";
