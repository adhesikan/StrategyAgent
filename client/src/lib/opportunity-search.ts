// Pure presentation helpers for Ask AI opportunity-search results.
// Deterministic backend candidates only — nothing here invents data.

export interface EstimatedOptions {
  strategy: string;
  status: "estimated";
  targetDteMin: number;
  targetDteMax: number;
  shortStrikeZone?: { low: number; high: number } | null;
  connectionRequiredForLiveContracts: boolean;
}

export interface OpportunityCard {
  symbol: string;
  strategy?: string;
  score?: number;
  stage?: string;
  direction?: string;
  timeframe?: string;
  price?: number;
  trigger?: number | null;
  reasons: string[];
  warnings: string[];
  freshness?: string;
  candidateState?: "stock" | "estimated_options" | "no_trade" | null;
  estimatedOptions?: EstimatedOptions | null;
}

export interface OpportunitySearchResult {
  type: "trade" | "bullish" | "bearish" | "vcp" | "income";
  source: string;
  generatedAt: string;
  brokerConnected: boolean;
  opportunities: OpportunityCard[];
}

export const SEARCH_TITLES: Record<OpportunitySearchResult["type"], string> = {
  trade: "Top Trade Opportunities",
  bullish: "Top Bullish Opportunities",
  bearish: "Bearish Opportunities",
  vcp: "Top VCP Setups",
  income: "Income Opportunities",
};

export function candidateStateLabel(state: OpportunityCard["candidateState"]): string | null {
  switch (state) {
    case "stock":
      return "Stock Candidate";
    case "estimated_options":
      return "Estimated Options Strategy";
    case "no_trade":
      return "No Trade";
    default:
      return null;
  }
}

export function optionStrategyLabel(strategy: string): string {
  return strategy
    .toLowerCase()
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
    .replace("Cash Secured", "Cash-Secured");
}

export function strikeZoneDisplay(zone: EstimatedOptions["shortStrikeZone"]): string | null {
  if (!zone || typeof zone.low !== "number" || typeof zone.high !== "number") return null;
  return `$${zone.low.toFixed(2)}–$${zone.high.toFixed(2)}`;
}

export interface CardCta {
  label: string;
  href: string;
  primary?: boolean;
}

/**
 * CTA gating: Trade Builder only when a deterministic candidate/setup state
 * supports it (stock candidate or pivot-ready stage). Estimated options with
 * no broker → Connect Broker CTA. No-trade → research navigation only.
 */
export function cardCtas(card: OpportunityCard, brokerConnected: boolean): CardCta[] {
  const sym = card.symbol.toUpperCase();
  const analyze: CardCta = { label: `Analyze ${sym}`, href: `/ask?q=${encodeURIComponent(`Analyze ${sym}`)}`, primary: true };
  if (card.candidateState === "no_trade") {
    return [analyze, { label: "Open Scanner", href: "/scanner" }];
  }
  if (card.candidateState === "estimated_options") {
    const ctas: CardCta[] = [];
    if (card.estimatedOptions?.connectionRequiredForLiveContracts && !brokerConnected) {
      ctas.push({ label: "Connect Broker", href: "/settings", primary: true });
      analyze.primary = false;
    }
    ctas.push(analyze);
    ctas.push({ label: "Open Income Mode", href: "/income-mode" });
    return ctas;
  }
  const stage = (card.stage ?? "").toLowerCase();
  if (card.candidateState === "stock" || stage === "pivot-ready") {
    return [analyze, { label: "View Setup", href: `/market-intel?symbol=${sym}` }, { label: "Open Trade Builder", href: `/trade/${sym}` }];
  }
  if (stage === "contraction") {
    return [analyze, { label: "View Setup", href: `/market-intel?symbol=${sym}` }];
  }
  return [analyze, { label: "View Chart", href: `/market-intel?symbol=${sym}` }];
}
