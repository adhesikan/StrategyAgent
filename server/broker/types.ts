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
  provider: "tradier" | "tradestation" | null;
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

export interface BrokerProvider {
  getStatus(accessToken: string): Promise<BrokerStatus>;
  getAccounts(accessToken: string): Promise<NormalizedAccount[]>;
  getPositions(accessToken: string, accountId?: string): Promise<NormalizedPosition[]>;
  getOrders(accessToken: string, accountId?: string): Promise<NormalizedOrder[]>;
  placeOrder(accessToken: string, order: OrderRequest): Promise<OrderResponse>;
  cancelOrder(accessToken: string, orderId: string, accountId?: string): Promise<{ success: boolean; message: string }>;
  getOptionQuote?(accessToken: string, optionSymbol: string): Promise<OptionQuote | null>;
}
