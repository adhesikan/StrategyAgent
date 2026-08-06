export interface NormalizedAccount {
  id: string;
  name: string;
  type: string;
  buyingPower: number;
  equity: number;
  currency: string;
}

export interface NormalizedPosition {
  symbol: string;
  qty: number;
  avgPrice: number;
  marketPrice: number;
  unrealizedPnl: number;
}

export interface NormalizedOrder {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  action?: string;
  qty: number;
  filledQty?: number;
  price?: number | null;
  stopPrice?: number | null;
  limitPrice?: number | null;
  status: string;
  createdAt: string;
  orderType?: "market" | "limit" | "stop" | "stop_limit" | string;
  groupOrderId?: string;
  groupOrderType?: string;
  legType?: "entry" | "stop_loss" | "profit_target" | "exit" | string;
  duration?: string;
}

export interface BrokerStatus {
  connected: boolean;
  provider: "tradier" | "tradestation" | "schwab" | null;
  accountId?: string;
}

export interface OrderRequest {
  accountId: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  orderType: "market" | "limit" | "stop" | "stop_limit";
  price?: number;
  stopPrice?: number;
  duration: "day" | "gtc" | "pre" | "post";
  orderClass?: "equity" | "option" | "otoco" | "oco";
  optionSymbol?: string;
  optionSide?: "buy_to_open" | "buy_to_close" | "sell_to_open" | "sell_to_close";
  bracketTarget?: number;
  bracketStop?: number;
}

export interface OrderResponse {
  orderId: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  status: string;
}

export interface OptionQuote {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  last: number;
  volume: number;
  openInterest: number;
}

/**
 * Capability map for a broker integration.
 *
 * Callers should check capabilities before invoking optional methods.
 * New capabilities should be added here (as optional booleans) rather than
 * scattered as broker-name conditionals throughout the codebase.
 */
export interface BrokerCapabilities {
  // ── Trading ──────────────────────────────────────────────────────────────
  nativeTrailingStop: boolean;
  stocks: boolean;
  options: boolean;
  spreads: boolean;
  // ── Market data ──────────────────────────────────────────────────────────
  /** Broker can supply real-time or delayed quotes for display purposes. */
  quotes?: boolean;
  /** Broker supports pre/post-market extended-hours quotes. */
  extendedHoursQuotes?: boolean;
  /**
   * Broker can supply validated historical OHLCV bars.
   *
   * When true, the BrokerProvider MAY implement getHistoricalBars().
   * Broker history may only be used for user-specific paths (Ask AI, personal
   * symbol analysis) — NEVER for global deterministic Opportunity Engine scans.
   * Using per-user broker history in a global scan would make scan results
   * user-dependent and non-deterministic.
   */
  historicalBars?: boolean;
  /** Broker can supply options chains (strikes, expirations). */
  optionsChain?: boolean;
  /** Broker can supply Greeks for options positions. */
  greeks?: boolean;
}

export interface BrokerProvider {
  capabilities?: BrokerCapabilities;
  getStatus(accessToken: string): Promise<BrokerStatus>;
  getAccounts(accessToken: string): Promise<NormalizedAccount[]>;
  getPositions(accessToken: string, accountId?: string): Promise<NormalizedPosition[]>;
  getOrders(accessToken: string, accountId?: string): Promise<NormalizedOrder[]>;
  placeOrder(accessToken: string, order: OrderRequest): Promise<OrderResponse>;
  cancelOrder(accessToken: string, orderId: string, accountId?: string): Promise<{ success: boolean; message: string }>;
  getOptionQuote?(accessToken: string, optionSymbol: string): Promise<OptionQuote | null>;
  /**
   * Optional: fetch historical daily bars for a symbol.
   * Only called when capabilities.historicalBars === true.
   * The returned bars must pass the same canonical validation as Twelve Data bars
   * and must record provider: "<broker_id>" in each NormalizedDailyBar.
   */
  getHistoricalBars?(
    accessToken: string,
    symbol: string,
    opts: { startDate?: string; endDate?: string; outputSize?: number },
  ): Promise<import("../services/daily-market-data/types").NormalizedDailyBar[]>;
}
