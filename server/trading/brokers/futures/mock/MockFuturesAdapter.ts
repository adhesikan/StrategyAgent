import { EventEmitter } from "events";
import type {
  IFuturesBrokerAdapter,
  FuturesTick,
  FuturesBar,
  FuturesOrderRequest,
  FuturesOrderUpdate,
  FuturesPositionUpdate,
} from "../types";
import { FUTURES_SYMBOLS } from "../types";

interface SymbolState {
  price: number;
  bid: number;
  ask: number;
  interval: ReturnType<typeof setInterval> | null;
  currentBar: FuturesBar | null;
  barStartTime: number;
}

const BASE_PRICES: Record<string, number> = {
  MES: 5420,
  MNQ: 19250,
  ES: 5420,
  NQ: 19250,
};

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

export class MockFuturesAdapter extends EventEmitter implements IFuturesBrokerAdapter {
  private connected = false;
  private symbols = new Map<string, SymbolState>();
  private orders = new Map<string, { req: FuturesOrderRequest; status: string }>();
  private positions = new Map<string, { qty: number; avgPrice: number }>();
  private orderCounter = 0;
  private rng: () => number;
  private tickIntervalMs: number;
  private pendingStopOrders = new Map<string, FuturesOrderRequest>();
  private pendingLimitOrders = new Map<string, FuturesOrderRequest>();

  constructor(options?: { seed?: number; tickIntervalMs?: number }) {
    super();
    this.rng = seededRandom(options?.seed ?? Date.now());
    this.tickIntervalMs = options?.tickIntervalMs ?? 250;
  }

  async connect(): Promise<void> {
    this.connected = true;
    this.emit("status", "connected");
  }

  async disconnect(): Promise<void> {
    const symbols = Array.from(this.symbols.keys());
    for (const symbol of symbols) {
      await this.unsubscribeMarketData(symbol);
    }
    this.connected = false;
    this.emit("status", "disconnected");
  }

  isConnected(): boolean {
    return this.connected;
  }

  getSubscribedSymbols(): string[] {
    return Array.from(this.symbols.keys());
  }

  async subscribeMarketData(symbol: string): Promise<void> {
    if (this.symbols.has(symbol)) return;

    const info = FUTURES_SYMBOLS.find((s) => s.symbol === symbol);
    if (!info) throw new Error(`Unknown futures symbol: ${symbol}`);

    const basePrice = BASE_PRICES[symbol] ?? 5000;
    const state: SymbolState = {
      price: basePrice,
      bid: basePrice - info.tickSize,
      ask: basePrice + info.tickSize,
      interval: null,
      currentBar: null,
      barStartTime: 0,
    };

    this.symbols.set(symbol, state);

    this.generateHistoricalBars(symbol, state, info.tickSize, 300);

    state.interval = setInterval(() => {
      this.generateTick(symbol, state, info.tickSize);
    }, this.tickIntervalMs);
  }

  private generateHistoricalBars(symbol: string, state: SymbolState, tickSize: number, count: number): void {
    const now = Math.floor(Date.now() / 1000);
    let price = state.price - (this.rng() - 0.5) * tickSize * count * 0.3;
    price = Math.round(price * 100) / 100;

    for (let i = count; i > 0; i--) {
      const time = now - i;
      const moves = 4;
      let open = price;
      let high = price;
      let low = price;

      for (let m = 0; m < moves; m++) {
        const drift = (this.rng() - 0.498) * tickSize * 4;
        price = Math.round((price + drift) * 100) / 100;
        high = Math.max(high, price);
        low = Math.min(low, price);
      }

      const bar: FuturesBar = {
        symbol,
        time,
        open,
        high,
        low,
        close: price,
        volume: Math.floor(this.rng() * 200) + 10,
      };
      this.emit("bar", bar);
    }

    state.price = price;
    state.bid = Math.round((price - tickSize) * 100) / 100;
    state.ask = Math.round((price + tickSize) * 100) / 100;

    const tick: FuturesTick = {
      symbol,
      price: state.price,
      bid: state.bid,
      ask: state.ask,
      volume: Math.floor(this.rng() * 50) + 1,
      timestamp: Date.now(),
    };
    this.emit("tick", tick);
  }

  async unsubscribeMarketData(symbol: string): Promise<void> {
    const state = this.symbols.get(symbol);
    if (state?.interval) {
      clearInterval(state.interval);
    }
    this.symbols.delete(symbol);
  }

  private generateTick(symbol: string, state: SymbolState, tickSize: number): void {
    const drift = (this.rng() - 0.498) * tickSize * 4;
    const roundedDrift = Math.round(drift / tickSize) * tickSize;
    state.price = Math.round((state.price + roundedDrift) * 100) / 100;
    const spread = tickSize * (1 + Math.floor(this.rng() * 2));
    state.bid = Math.round((state.price - spread / 2) * 100) / 100;
    state.ask = Math.round((state.price + spread / 2) * 100) / 100;

    const tick: FuturesTick = {
      symbol,
      price: state.price,
      bid: state.bid,
      ask: state.ask,
      volume: Math.floor(this.rng() * 50) + 1,
      timestamp: Date.now(),
    };
    this.emit("tick", tick);
    this.checkPendingOrders(symbol, state.price);

    const now = Date.now();
    const barSecond = Math.floor(now / 1000) * 1000;

    if (!state.currentBar || state.barStartTime !== barSecond) {
      if (state.currentBar) {
        this.emit("bar", { ...state.currentBar });
      }
      state.barStartTime = barSecond;
      state.currentBar = {
        symbol,
        time: barSecond / 1000,
        open: state.price,
        high: state.price,
        low: state.price,
        close: state.price,
        volume: tick.volume,
      };
    } else {
      state.currentBar.high = Math.max(state.currentBar.high, state.price);
      state.currentBar.low = Math.min(state.currentBar.low, state.price);
      state.currentBar.close = state.price;
      state.currentBar.volume += tick.volume;
    }
  }

  async placeOrder(req: FuturesOrderRequest): Promise<{ brokerOrderId: string }> {
    this.orderCounter++;
    const brokerOrderId = `MOCK-FUT-${this.orderCounter}-${Date.now()}`;

    this.orders.set(brokerOrderId, { req, status: "accepted" });

    const acceptUpdate: FuturesOrderUpdate = {
      brokerOrderId,
      symbol: req.symbol,
      side: req.side,
      qty: req.qty,
      status: "accepted",
    };
    setTimeout(() => this.emit("orderUpdate", acceptUpdate), 100);

    if (req.orderType === "stop" && req.stopPrice) {
      this.pendingStopOrders.set(brokerOrderId, req);
      return { brokerOrderId };
    }

    if (req.orderType === "limit" && req.limitPrice) {
      this.pendingLimitOrders.set(brokerOrderId, req);
      return { brokerOrderId };
    }

    const state = this.symbols.get(req.symbol);
    const fillPrice = state
      ? req.side === "buy"
        ? state.ask + (this.rng() * 0.5 - 0.1)
        : state.bid - (this.rng() * 0.5 - 0.1)
      : (BASE_PRICES[req.symbol] ?? 5000);

    const roundedFillPrice = Math.round(fillPrice * 100) / 100;

    setTimeout(() => {
      this.fillOrder(brokerOrderId, req, roundedFillPrice);
    }, 500 + Math.floor(this.rng() * 500));

    return { brokerOrderId };
  }

  private fillOrder(brokerOrderId: string, req: FuturesOrderRequest, fillPrice: number): void {
    const order = this.orders.get(brokerOrderId);
    if (!order || order.status === "canceled") return;

    this.orders.set(brokerOrderId, { req, status: "filled" });

    const fillUpdate: FuturesOrderUpdate = {
      brokerOrderId,
      symbol: req.symbol,
      side: req.side,
      qty: req.qty,
      status: "filled",
      fillPrice,
      filledAt: Date.now(),
    };
    this.emit("orderUpdate", fillUpdate);
    this.updatePosition(req.symbol, req.side, req.qty, fillPrice);

    if (req.linkedToOrderId) {
      this.cancelLinkedOrders(req.linkedToOrderId, brokerOrderId);
    }
  }

  private cancelLinkedOrders(groupId: string, exceptOrderId: string): void {
    for (const [id, req] of Array.from(this.pendingStopOrders.entries())) {
      if (id !== exceptOrderId && req.linkedToOrderId === groupId) {
        this.pendingStopOrders.delete(id);
        this.cancelOrderSilent(id);
      }
    }
    for (const [id, req] of Array.from(this.pendingLimitOrders.entries())) {
      if (id !== exceptOrderId && req.linkedToOrderId === groupId) {
        this.pendingLimitOrders.delete(id);
        this.cancelOrderSilent(id);
      }
    }
    for (const [id, entry] of Array.from(this.orders.entries())) {
      if (id !== exceptOrderId && entry.req.linkedToOrderId === groupId && entry.status === "accepted") {
        this.pendingStopOrders.delete(id);
        this.pendingLimitOrders.delete(id);
        this.cancelOrderSilent(id);
      }
    }
  }

  private cancelOrderSilent(brokerOrderId: string): void {
    const order = this.orders.get(brokerOrderId);
    if (order && order.status !== "filled") {
      order.status = "canceled";
      this.emit("orderUpdate", {
        brokerOrderId,
        symbol: order.req.symbol,
        side: order.req.side,
        qty: order.req.qty,
        status: "canceled",
      });
    }
  }

  private checkPendingOrders(symbol: string, price: number): void {
    for (const [id, req] of Array.from(this.pendingStopOrders.entries())) {
      if (req.symbol !== symbol) continue;
      const triggered =
        (req.side === "sell" && price <= req.stopPrice!) ||
        (req.side === "buy" && price >= req.stopPrice!);
      if (triggered) {
        this.pendingStopOrders.delete(id);
        this.fillOrder(id, req, Math.round(price * 100) / 100);
      }
    }
    for (const [id, req] of Array.from(this.pendingLimitOrders.entries())) {
      if (req.symbol !== symbol) continue;
      const triggered =
        (req.side === "sell" && price >= req.limitPrice!) ||
        (req.side === "buy" && price <= req.limitPrice!);
      if (triggered) {
        this.pendingLimitOrders.delete(id);
        this.fillOrder(id, req, req.limitPrice!);
      }
    }
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    const order = this.orders.get(brokerOrderId);
    if (!order) throw new Error(`Order not found: ${brokerOrderId}`);
    if (order.status === "filled") throw new Error("Cannot cancel filled order");

    this.pendingStopOrders.delete(brokerOrderId);
    this.pendingLimitOrders.delete(brokerOrderId);

    order.status = "canceled";
    const update: FuturesOrderUpdate = {
      brokerOrderId,
      symbol: order.req.symbol,
      side: order.req.side,
      qty: order.req.qty,
      status: "canceled",
    };
    this.emit("orderUpdate", update);
  }

  private updatePosition(symbol: string, side: "buy" | "sell", qty: number, fillPrice: number): void {
    const existing = this.positions.get(symbol) ?? { qty: 0, avgPrice: 0 };
    const direction = side === "buy" ? 1 : -1;
    const newQty = existing.qty + qty * direction;

    let newAvgPrice = existing.avgPrice;
    if (Math.sign(newQty) === direction || existing.qty === 0) {
      const totalCost = existing.avgPrice * Math.abs(existing.qty) + fillPrice * qty;
      newAvgPrice = totalCost / (Math.abs(existing.qty) + qty);
    }

    if (newQty === 0) {
      this.positions.delete(symbol);
    } else {
      this.positions.set(symbol, { qty: newQty, avgPrice: Math.round(newAvgPrice * 100) / 100 });
    }

    const pos = this.positions.get(symbol);
    const state = this.symbols.get(symbol);
    const currentPrice = state?.price ?? fillPrice;

    const posUpdate: FuturesPositionUpdate = {
      symbol,
      qty: pos?.qty ?? 0,
      avgPrice: pos?.avgPrice ?? 0,
      unrealizedPnl: pos ? Math.round((currentPrice - pos.avgPrice) * pos.qty * 100) / 100 : 0,
    };
    this.emit("position", posUpdate);
  }
}
