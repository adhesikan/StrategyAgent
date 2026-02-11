import { EventEmitter } from "events";

export interface FuturesTick {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  volume: number;
  timestamp: number;
}

export interface FuturesBar {
  symbol: string;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FuturesOrderRequest {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  orderType: "market" | "limit" | "stop";
  limitPrice?: number;
  stopPrice?: number;
  linkedToOrderId?: string;
}

export interface FuturesOrderUpdate {
  brokerOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  status: "accepted" | "filled" | "rejected" | "canceled";
  fillPrice?: number;
  filledAt?: number;
}

export interface FuturesPositionUpdate {
  symbol: string;
  qty: number;
  avgPrice: number;
  unrealizedPnl: number;
}

export const FUTURES_SYMBOLS = [
  { symbol: "ES", name: "E-mini S&P 500", tickSize: 0.25, pointValue: 50, exchange: "CME" },
  { symbol: "NQ", name: "E-mini Nasdaq-100", tickSize: 0.25, pointValue: 20, exchange: "CME" },
  { symbol: "YM", name: "E-mini Dow", tickSize: 1, pointValue: 5, exchange: "CBOT" },
  { symbol: "RTY", name: "E-mini Russell 2000", tickSize: 0.1, pointValue: 50, exchange: "CME" },
  { symbol: "MES", name: "Micro E-mini S&P 500", tickSize: 0.25, pointValue: 5, exchange: "CME" },
  { symbol: "MNQ", name: "Micro E-mini Nasdaq-100", tickSize: 0.25, pointValue: 2, exchange: "CME" },
  { symbol: "MYM", name: "Micro E-mini Dow", tickSize: 1, pointValue: 0.5, exchange: "CBOT" },
  { symbol: "M2K", name: "Micro E-mini Russell 2000", tickSize: 0.1, pointValue: 5, exchange: "CME" },
  { symbol: "GC", name: "Gold", tickSize: 0.1, pointValue: 100, exchange: "COMEX" },
  { symbol: "SI", name: "Silver", tickSize: 0.005, pointValue: 5000, exchange: "COMEX" },
  { symbol: "CL", name: "Crude Oil", tickSize: 0.01, pointValue: 1000, exchange: "NYMEX" },
  { symbol: "NG", name: "Natural Gas", tickSize: 0.001, pointValue: 10000, exchange: "NYMEX" },
  { symbol: "ZB", name: "30-Year T-Bond", tickSize: 0.03125, pointValue: 1000, exchange: "CBOT" },
  { symbol: "ZN", name: "10-Year T-Note", tickSize: 0.015625, pointValue: 1000, exchange: "CBOT" },
  { symbol: "ZC", name: "Corn", tickSize: 0.25, pointValue: 50, exchange: "CBOT" },
  { symbol: "ZS", name: "Soybeans", tickSize: 0.25, pointValue: 50, exchange: "CBOT" },
  { symbol: "ZW", name: "Wheat", tickSize: 0.25, pointValue: 50, exchange: "CBOT" },
  { symbol: "HE", name: "Lean Hogs", tickSize: 0.025, pointValue: 400, exchange: "CME" },
  { symbol: "LE", name: "Live Cattle", tickSize: 0.025, pointValue: 400, exchange: "CME" },
  { symbol: "6E", name: "Euro FX", tickSize: 0.00005, pointValue: 125000, exchange: "CME" },
  { symbol: "6J", name: "Japanese Yen", tickSize: 0.0000005, pointValue: 12500000, exchange: "CME" },
  { symbol: "6B", name: "British Pound", tickSize: 0.0001, pointValue: 62500, exchange: "CME" },
  { symbol: "MGC", name: "Micro Gold", tickSize: 0.1, pointValue: 10, exchange: "COMEX" },
  { symbol: "MCL", name: "Micro Crude Oil", tickSize: 0.01, pointValue: 100, exchange: "NYMEX" },
] as const;

export type FuturesSymbolInfo = typeof FUTURES_SYMBOLS[number];

export interface FuturesAdapterEvents {
  tick: (tick: FuturesTick) => void;
  bar: (bar: FuturesBar) => void;
  orderUpdate: (update: FuturesOrderUpdate) => void;
  position: (pos: FuturesPositionUpdate) => void;
  status: (status: "connected" | "disconnected" | "reconnecting") => void;
}

// TODO: When integrating real Rithmic adapter, implement this interface.
// The MockFuturesAdapter serves as the reference implementation.
export interface IFuturesBrokerAdapter extends EventEmitter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribeMarketData(symbol: string): Promise<void>;
  unsubscribeMarketData(symbol: string): Promise<void>;
  placeOrder(req: FuturesOrderRequest): Promise<{ brokerOrderId: string }>;
  cancelOrder(brokerOrderId: string): Promise<void>;
  getSubscribedSymbols(): string[];
  isConnected(): boolean;

  on<K extends keyof FuturesAdapterEvents>(event: K, listener: FuturesAdapterEvents[K]): this;
  emit<K extends keyof FuturesAdapterEvents>(event: K, ...args: Parameters<FuturesAdapterEvents[K]>): boolean;
}
