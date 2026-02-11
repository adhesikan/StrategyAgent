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
  orderType: "market" | "limit";
  limitPrice?: number;
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
  { symbol: "MES", name: "Micro E-mini S&P 500", tickSize: 0.25, pointValue: 5 },
  { symbol: "MNQ", name: "Micro E-mini Nasdaq-100", tickSize: 0.25, pointValue: 2 },
  { symbol: "ES", name: "E-mini S&P 500", tickSize: 0.25, pointValue: 50 },
  { symbol: "NQ", name: "E-mini Nasdaq-100", tickSize: 0.25, pointValue: 20 },
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
