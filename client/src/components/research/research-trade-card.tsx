// ResearchTradeCard — Professional institutional research workspace.
// Orchestrates StockTradeCard, OptionsTradeCard, EvidenceCard, RiskCard,
// and ActionCard into a single cohesive view for the Overview tab.
//
// Sprint 2.2.1: passes pkg to EvidenceCard so deterministic numeric scores
// (Technical, Regime) can be computed using candidate fields + market regime.

import { StockTradeCard } from "./stock-trade-card";
import { OptionsTradeCard, shouldShowOptionsCard } from "./options-trade-card";
import { EvidenceCard } from "./evidence-card";
import { RiskCard } from "./risk-card";
import { ActionCard } from "./action-card";
import type { ResearchPackage, EvidenceStars, MarketSnapshot } from "./types";

// ---------------------------------------------------------------------------
// ResearchTradeCard
// ---------------------------------------------------------------------------

interface ResearchTradeCardProps {
  pkg: ResearchPackage;
  stars: EvidenceStars;
  snapshot?: MarketSnapshot;
  onNavigateTab: (tab: string) => void;
}

export function ResearchTradeCard({
  pkg,
  stars,
  snapshot,
  onNavigateTab,
}: ResearchTradeCardProps) {
  const highImpactNews = (snapshot?.topNews ?? []).filter(
    (n) => n.impact === "high",
  );
  const showOptions = shouldShowOptionsCard(pkg.candidate);

  return (
    <div className="space-y-4" data-testid="research-trade-card">
      {/* Row 1: Stock parameters (2/3) + Evidence signals (1/3) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        <div className="md:col-span-2">
          <StockTradeCard pkg={pkg} />
        </div>
        <div className="md:col-span-1">
          <EvidenceCard
            stars={stars}
            completedAt={pkg.completedAt}
            onViewEvidence={() => onNavigateTab("technical")}
            onViewCongress={() => onNavigateTab("congress")}
            pkg={pkg}
          />
        </div>
      </div>

      {/* Row 2: Options structure (conditional) */}
      {showOptions && <OptionsTradeCard pkg={pkg} />}

      {/* Row 3: Risk + Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        <RiskCard pkg={pkg} highImpactNews={highImpactNews} />
        <ActionCard
          pkg={pkg}
          symbol={pkg.symbol}
          onNavigateTab={onNavigateTab}
        />
      </div>
    </div>
  );
}
