// Client-side type mirror for the portfolio-constrained trade plan.
// Keep in sync with server/routes/portfolio-trade-plan.ts — types only,
// no server-side logic here.

export interface PortfolioTradePlanGoal {
  kind:
    | "dollar_risk"
    | "percent_of_portfolio"
    | "sector_exclusion"
    | "require_existing_position"
    | "income_from_holdings";
  maxRiskDollars?: number;
  maxRiskPercent?: number;
  excludeSectors?: string[];
  requireExistingPosition?: boolean;
  objective?: "income" | "growth";
  direction?: "bullish" | "bearish" | "neutral" | "either";
}

export interface PortfolioTradePlanConstraint {
  name: string;
  status: "met" | "partially_met" | "not_met" | "unknown";
  detail?: string;
}

export interface PortfolioTradePlanCandidate {
  rank: number;
  symbol: string;
  strategy?: string;
  direction?: string;
  instrument?: string;
  entryPrice?: number;
  stopPrice?: number;
  targetPrice?: number;
  maxRiskDollars?: number;
  maxRiskIsExact?: boolean;
  quantity?: number;
  rewardRisk?: number;
  whySelected: string[];
  warnings: string[];
}

export interface PortfolioTradePlanAlternative {
  symbol?: string;
  strategy?: string;
  whyFailed: string;
}

export interface PortfolioTradePlanImpact {
  concentrationEffect?: string;
  capitalEffect?: string;
  diversificationNote?: string;
}

export interface PortfolioTradePlanRisk {
  primaryRisk?: string;
  otherRisks?: string[];
}

export interface PortfolioTradePlan {
  feasibility: {
    feasible: boolean;
    reason?: string;
  };
  portfolioConstraints: PortfolioTradePlanConstraint[];
  qualifiedCandidates: PortfolioTradePlanCandidate[];
  whySelected?: string[];
  alternatives?: PortfolioTradePlanAlternative[];
  portfolioImpact?: PortfolioTradePlanImpact;
  risks?: PortfolioTradePlanRisk;
  nextSteps?: string[];
  generatedAt: string;
  warnings: string[];
}
