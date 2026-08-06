// TradeStructureCard — orchestrates a complete view of one trade structure
// (stock + primary options + reason + risk sections).
// This is the top-level card used within the Trade Planning tab.
// No new API calls. All data flows from existing ResearchPackage.

import type { ResearchPackage, EvidenceStars, StockStructure, OptionsStructure, StructureRiskProfile } from "./types";
import type { Thesis } from "../decision/types";
import { StockStructureCard } from "./stock-structure-card";
import { OptionsStructureCard } from "./options-structure-card";
import {
  TradeStructureReasonCard,
  buildStockStructureReason,
  buildOptionsStructureReason,
} from "./trade-structure-reason-card";
import {
  TradeStructureRiskCard,
  buildStockRiskProfile,
  buildOptionsRiskProfile,
} from "./trade-structure-risk-card";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TradeStructureCardProps {
  pkg: ResearchPackage;
  stars: EvidenceStars;
  thesis: Thesis;
  stockStructure: StockStructure;
  optionsStructures: OptionsStructure[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TradeStructureCard({
  pkg,
  stars,
  thesis,
  stockStructure,
  optionsStructures,
}: TradeStructureCardProps) {
  const primaryOptions = optionsStructures[0] ?? null;

  const stockReason = buildStockStructureReason(stockStructure);
  const optionsReason = primaryOptions
    ? buildOptionsStructureReason(primaryOptions)
    : undefined;

  const stockRisk = buildStockRiskProfile(stockStructure, pkg);
  const optionsRisk = primaryOptions
    ? buildOptionsRiskProfile(primaryOptions, pkg)
    : undefined;

  return (
    <div className="space-y-4" data-testid="trade-structure-card">
      {/* Row 1: Stock structure (2/3) + Options structure (1/3 if present) */}
      <div
        className={
          primaryOptions
            ? "grid grid-cols-1 md:grid-cols-3 gap-4 items-start"
            : "w-full"
        }
      >
        <div className={primaryOptions ? "md:col-span-2" : "w-full"}>
          <StockStructureCard pkg={pkg} />
        </div>
        {primaryOptions && (
          <div className="md:col-span-1">
            <OptionsStructureCard pkg={pkg} thesis={thesis} />
          </div>
        )}
      </div>

      {/* Row 2: Structure rationale */}
      <TradeStructureReasonCard
        stockReason={stockReason}
        optionsReason={optionsReason}
      />

      {/* Row 3: Risk characteristics */}
      <TradeStructureRiskCard
        stockRisk={stockRisk}
        optionsRisk={optionsRisk}
        optionsLabel={primaryOptions?.label}
      />
    </div>
  );
}
