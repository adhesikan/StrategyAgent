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

// ---------------------------------------------------------------------------
// "Prepare in Trade Builder" handoff — USER-INITIATED ONLY.
// A card is prepare-eligible only when its data is deterministic enough to
// prefill a real ticket: a live option candidate (every leg priced from the
// live chain) or a stock candidate with a risk estimate. The handoff only
// PREFILLS the Trade Builder; the user reviews/edits everything and must
// explicitly continue and confirm through InstaTrade.
// ---------------------------------------------------------------------------

export function prepareEligible(card: OpportunityCard): boolean {
  if (card.candidateState === "live_options" && card.liveOption && card.liveOption.legs.length > 0) return true;
  if (card.candidateState === "stock" && card.riskEstimate?.stopPrice != null) return true;
  return false;
}

/** Body for POST /api/trade/prepare-ticket, built only from displayed card data. */
export function prepareTicketRequest(card: OpportunityCard): Record<string, unknown> | null {
  const sym = card.symbol.toUpperCase();
  if (card.candidateState === "live_options" && card.liveOption) {
    const lo = card.liveOption;
    return {
      symbol: sym,
      assetType: "option",
      strategy: lo.strategy,
      netKind: lo.netKind,
      estimatedNet: lo.estimatedNet,
      maxLoss: lo.maxLoss ?? null,
      maxProfit: lo.maxProfit ?? null,
      breakeven: lo.breakeven ?? null,
      expiration: lo.expiration,
      legs: lo.legs.map((l) => ({
        action: l.action,
        type: l.type,
        strike: l.strike,
        ...(l.expiration ? { expiration: l.expiration } : {}),
        ...(l.optionSymbol ? { optionSymbol: l.optionSymbol } : {}),
        ...(typeof l.mid === "number" && l.mid > 0 ? { mid: l.mid } : {}),
      })),
    };
  }
  if (card.candidateState === "stock" && card.riskEstimate) {
    const re = card.riskEstimate;
    return {
      symbol: sym,
      assetType: "stock",
      strategy: "stock_swing",
      ...(typeof card.trigger === "number" && card.trigger > 0
        ? { entryPrice: card.trigger }
        : typeof card.price === "number" && card.price > 0
          ? { entryPrice: card.price }
          : {}),
      ...(typeof re.stopPrice === "number" && re.stopPrice > 0 ? { stopPrice: re.stopPrice } : {}),
      ...(card.technicalObjective && card.technicalObjective.price > 0
        ? { targetPrice: card.technicalObjective.price }
        : {}),
      ...(typeof re.suggestedMaxShares === "number" && re.suggestedMaxShares >= 1
        ? { quantity: Math.floor(re.suggestedMaxShares) }
        : {}),
      ...(typeof re.maxRiskDollars === "number" && re.maxRiskDollars > 0
        ? { maxRiskDollars: re.maxRiskDollars }
        : {}),
    };
  }
  return null;
}

/** Trade Builder URL params for a prepare-eligible card. */
export function prepareTradeParams(card: OpportunityCard): { type: string; strategy: string } {
  if (card.candidateState === "live_options" && card.liveOption) {
    const s = card.liveOption.strategy.toLowerCase();
    const isCredit = card.liveOption.netKind === "credit";
    // Credit vs debit matters: a credit spread routed as "debit-spread" would
    // mislabel the structure in the Trade Builder.
    if (s.includes("spread") || s.includes("vertical")) {
      return { type: "vertical", strategy: isCredit ? "short-premium" : "debit-spread" };
    }
    if (s.includes("covered")) return { type: "short-premium", strategy: "covered-call" };
    if (s.includes("cash") || s.includes("secured")) return { type: "short-premium", strategy: "cash-secured-put" };
    if (isCredit) return { type: "short-premium", strategy: "short-premium" };
    if (s.includes("put")) return { type: "long-put", strategy: "long-put" };
    return { type: "long-call", strategy: "long-call" };
  }
  return { type: "stock", strategy: "stock-swing" };
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
