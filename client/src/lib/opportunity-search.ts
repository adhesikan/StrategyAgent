// Pure presentation helpers for Ask AI opportunity-search results.
// Deterministic backend candidates only — nothing here invents data.

export interface EstimatedOptions {
  strategy: string;
  status: "estimated";
  targetDteMin: number;
  targetDteMax: number;
  shortStrikeZone?: { low: number; high: number } | null;
  longStrikeZone?: { low: number; high: number } | null;
  /** Explicit limitations of an estimated (no live chain) structure. */
  limitations?: string[];
  /** e.g. "defined-risk" / "undefined-risk" / "collateralized". */
  riskStyle?: string | null;
  connectionRequiredForLiveContracts: boolean;
}

export interface LiveOptionLeg {
  action: "buy" | "sell";
  type: "call" | "put";
  strike: number;
  expiration?: string | null;
  bid?: number | null;
  ask?: number | null;
  mid?: number | null;
  delta?: number | null;
  theta?: number | null;
  iv?: number | null;
  volume?: number | null;
  openInterest?: number | null;
  optionSymbol?: string | null;
}

/** Present ONLY when the backend's full live options pipeline succeeded. */
export interface LiveOptionCandidate {
  status: "live";
  strategy: string;
  expiration: string;
  dte?: number | null;
  legs: LiveOptionLeg[];
  priceBasis: "mid" | "bid_ask";
  /** Net per contract: positive = credit received, negative = debit paid. */
  estimatedNet: number;
  netKind: "debit" | "credit";
  maxLoss?: number | null;
  maxProfit?: number | null;
  breakeven?: number[] | null;
  liquidityQuality?: string | null;
  liquidityNotes?: string[];
  rankReasons: string[];
  warnings?: string[];
}

export interface PriceLevel {
  price: number;
  basis?: string;
}

export interface RiskEstimate {
  riskPerShare?: number | null;
  suggestedMaxShares?: number | null;
  maxRiskDollars?: number | null;
  stopPrice?: number | null;
  stopBasis?: string | null;
  warnings?: string[];
}

export type CandidateVerdict = "STOCK" | "ESTIMATED_OPTIONS" | "NO_TRADE";

export interface OpportunityCard {
  /** 1-based rank from the deterministic search (MCP-backed searches). */
  rank?: number;
  symbol: string;
  strategy?: string;
  score?: number;
  stage?: string;
  /** Normalized setup status from the MCP scan (forming/ready/...). */
  status?: string;
  direction?: string;
  timeframe?: string;
  price?: number;
  trigger?: number | null;
  invalidation?: PriceLevel | null;
  technicalObjective?: PriceLevel | null;
  reasons: string[];
  warnings: string[];
  freshness?: string;
  candidateState?: "stock" | "estimated_options" | "live_options" | "no_trade" | null;
  /** Deterministic engine verdict (MCP build_trade_candidate). */
  verdict?: CandidateVerdict | null;
  riskEstimate?: RiskEstimate | null;
  liveOption?: LiveOptionCandidate | null;
  estimatedOptions?: EstimatedOptions | null;
}

export interface OpportunitySearchResult {
  type: "trade" | "bullish" | "bearish" | "vcp" | "income";
  intent?: string;
  source: string;
  generatedAt: string;
  brokerConnected: boolean;
  maxRiskDollars?: number | null;
  excludedByRisk?: number;
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
    case "live_options":
      return "Live Option Candidate";
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
  // "View Setup" always opens the trade setup page (/trade/:symbol) —
  // charts/research live behind "View Chart" (/market-intel) instead.
  const viewSetup: CardCta = { label: "View Setup", href: `/trade/${sym}` };
  if (card.candidateState === "no_trade") {
    // NO_TRADE is a valid, honest verdict — the setup page still shows the
    // levels/why-not; order actions remain gated there.
    return [analyze, viewSetup, { label: "Open Scanner", href: "/scanner" }];
  }
  if (card.candidateState === "live_options") {
    // Live candidate — order actions stay in the trade setup page.
    return [
      { ...viewSetup, primary: true },
      { ...analyze, primary: false },
      { label: "View Chart", href: `/market-intel?symbol=${sym}` },
    ];
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
    return [analyze, viewSetup, { label: "View Chart", href: `/market-intel?symbol=${sym}` }];
  }
  if (stage === "contraction") {
    return [analyze, viewSetup];
  }
  return [analyze, { label: "View Chart", href: `/market-intel?symbol=${sym}` }];
}
