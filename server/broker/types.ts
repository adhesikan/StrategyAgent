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
  qty: number;
  status: string;
  createdAt: string;
}

export interface BrokerStatus {
  connected: boolean;
  provider: "tradier" | "tradestation" | null;
  accountId?: string;
}

export interface BrokerProvider {
  getStatus(accessToken: string): Promise<BrokerStatus>;
  getAccounts(accessToken: string): Promise<NormalizedAccount[]>;
  getPositions(accessToken: string, accountId?: string): Promise<NormalizedPosition[]>;
  getOrders(accessToken: string, accountId?: string): Promise<NormalizedOrder[]>;
}
