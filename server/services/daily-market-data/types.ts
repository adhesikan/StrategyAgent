// Provider-neutral daily market data contracts. Downstream systems
// (Opportunity Radar, Probability Engine, Analysis Conditions, Grow Mode)
// must consume these normalized types — never raw provider responses.

export type NormalizedDailyBar = {
  symbol: string;
  tradeDate: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  adjustedClose?: number | null;
  volume: number;
  provider: string;
  providerTimestamp?: string | null;
  isComplete: boolean;
};

export type ProviderHealthResult = {
  ok: boolean;
  provider: string;
  latencyMs?: number;
  message?: string;
};

export interface DailyMarketDataProvider {
  providerName: string;
  getDailyBars(params: {
    symbol: string;
    startDate?: string;
    endDate?: string;
    outputSize?: number;
  }): Promise<NormalizedDailyBar[]>;
  getLatestDailyBar(params: { symbol: string }): Promise<NormalizedDailyBar | null>;
  healthCheck(): Promise<ProviderHealthResult>;
}

export class MarketDataProviderError extends Error {
  constructor(
    message: string,
    public code:
      | "AUTH"
      | "QUOTA"
      | "UNSUPPORTED_SYMBOL"
      | "EMPTY"
      | "TIMEOUT"
      | "MALFORMED"
      | "NETWORK"
      | "DISABLED"
      | "UNKNOWN"
      // Specific credit / rate-limit classifications — never collapse into generic UNKNOWN.
      | "RATE_LIMITED"  // per-minute rate limit from provider or credit manager
      | "DAILY_LIMIT"   // daily credit/quota limit exhausted
      | "WAIT_TIMEOUT"  // credit-reservation wait exceeded max wait time
      // Response-quality classification (distinct from general MALFORMED)
      | "BAD_RESPONSE", // provider returned unparseable or structurally invalid response
    public permanent: boolean = false,
  ) {
    super(message);
    this.name = "MarketDataProviderError";
  }
}
