import { EventEmitter } from "events";
import type {
  IFuturesBrokerAdapter,
  FuturesTick,
  FuturesBar,
  FuturesOrderRequest,
  FuturesOrderUpdate,
} from "../types";
import { FUTURES_SYMBOLS } from "../types";

interface TSFuturesConfig {
  accessToken: string;
  refreshTokenFn?: () => Promise<string | null>;
  simMode?: boolean;
  accountId?: string;
}

function toTSSymbol(symbol: string): string {
  return `@${symbol}`;
}

function fromTSSymbol(tsSymbol: string): string {
  return tsSymbol.startsWith("@") ? tsSymbol.slice(1) : tsSymbol;
}

export class TradeStationFuturesAdapter extends EventEmitter implements IFuturesBrokerAdapter {
  private config: TSFuturesConfig;
  private baseUrl: string;
  private connected = false;
  private subscribedSymbols = new Set<string>();
  private activeStreams = new Map<string, AbortController>();
  private barAccumulators = new Map<string, FuturesBar>();
  private barTimers = new Map<string, ReturnType<typeof setInterval>>();
  private orderCounter = 0;

  constructor(config: TSFuturesConfig) {
    super();
    this.config = config;
    this.baseUrl = config.simMode
      ? "https://sim-api.tradestation.com/v3"
      : "https://api.tradestation.com/v3";
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.accessToken}`,
      Accept: "application/json",
    };
  }

  private get streamHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.accessToken}`,
      Accept: "application/vnd.tradestation.streams.v2+json",
    };
  }

  async connect(): Promise<void> {
    try {
      const resp = await fetch(`${this.baseUrl}/brokerage/accounts`, {
        headers: this.headers,
      });
      if (!resp.ok) {
        throw new Error(`TradeStation futures connect failed: ${resp.status}`);
      }
      const data = await resp.json();
      const accounts = data?.Accounts || data || [];
      if (Array.isArray(accounts) && accounts.length > 0) {
        const futuresAccount = accounts.find((a: any) =>
          a.AccountType === "Futures" || a.AccountType === "FuturesOptions"
        ) || accounts[0];
        if (!this.config.accountId) {
          this.config.accountId = futuresAccount.AccountID;
        }
      }
      this.connected = true;
      this.emit("status", "connected");
      console.log(`[TSFutures] Connected (accountId=${this.config.accountId}, sim=${!!this.config.simMode})`);
    } catch (err) {
      console.error("[TSFutures] Connect error:", (err as Error).message);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    for (const symbol of Array.from(this.activeStreams.keys())) {
      await this.unsubscribeMarketData(symbol);
    }
    this.connected = false;
    this.emit("status", "disconnected");
    console.log("[TSFutures] Disconnected");
  }

  isConnected(): boolean {
    return this.connected;
  }

  getSubscribedSymbols(): string[] {
    return Array.from(this.subscribedSymbols);
  }

  async subscribeMarketData(symbol: string): Promise<void> {
    if (this.subscribedSymbols.has(symbol)) return;

    const info = FUTURES_SYMBOLS.find((s) => s.symbol === symbol);
    if (!info) throw new Error(`Unknown futures symbol: ${symbol}`);

    this.subscribedSymbols.add(symbol);
    const tsSymbol = toTSSymbol(symbol);

    await this.fetchHistoricalBars(symbol, tsSymbol);

    this.startQuoteStream(symbol, tsSymbol, info.tickSize);

    console.log(`[TSFutures] Subscribed to ${symbol} (${tsSymbol})`);
  }

  async unsubscribeMarketData(symbol: string): Promise<void> {
    this.subscribedSymbols.delete(symbol);

    const controller = this.activeStreams.get(symbol);
    if (controller) {
      controller.abort();
      this.activeStreams.delete(symbol);
    }

    const timer = this.barTimers.get(symbol);
    if (timer) {
      clearInterval(timer);
      this.barTimers.delete(symbol);
    }

    this.barAccumulators.delete(symbol);
    console.log(`[TSFutures] Unsubscribed from ${symbol}`);
  }

  private async fetchHistoricalBars(symbol: string, tsSymbol: string): Promise<void> {
    try {
      const url = `${this.baseUrl}/marketdata/barcharts/${encodeURIComponent(tsSymbol)}?interval=1&unit=Minute&barsback=300`;
      const resp = await fetch(url, { headers: this.headers });
      if (!resp.ok) {
        console.warn(`[TSFutures] Historical bars fetch failed for ${symbol}: ${resp.status}`);
        return;
      }
      const data = await resp.json();
      const bars = data?.Bars || data || [];
      if (!Array.isArray(bars)) return;

      for (const b of bars) {
        if (b.IsEndOfHistory) continue;
        const bar: FuturesBar = {
          symbol,
          time: Math.floor(new Date(b.TimeStamp || b.Epoch).getTime() / 1000),
          open: parseFloat(b.Open ?? "0"),
          high: parseFloat(b.High ?? "0"),
          low: parseFloat(b.Low ?? "0"),
          close: parseFloat(b.Close ?? "0"),
          volume: parseInt(b.TotalVolume ?? b.Volume ?? "0", 10),
        };
        this.emit("bar", bar);
      }
      console.log(`[TSFutures] Loaded ${bars.length} historical bars for ${symbol}`);
    } catch (err) {
      console.warn(`[TSFutures] Historical bars error for ${symbol}:`, (err as Error).message);
    }
  }

  private async startQuoteStream(symbol: string, tsSymbol: string, tickSize: number): Promise<void> {
    const controller = new AbortController();
    this.activeStreams.set(symbol, controller);

    const barTimer = setInterval(() => {
      const bar = this.barAccumulators.get(symbol);
      if (bar) {
        this.emit("bar", { ...bar });
        this.barAccumulators.delete(symbol);
      }
    }, 1000);
    this.barTimers.set(symbol, barTimer);

    const streamUrl = `${this.baseUrl}/marketdata/stream/quotes/${encodeURIComponent(tsSymbol)}`;

    const connectStream = async () => {
      while (this.subscribedSymbols.has(symbol) && !controller.signal.aborted) {
        try {
          const resp = await fetch(streamUrl, {
            headers: this.streamHeaders,
            signal: controller.signal,
          });

          if (!resp.ok) {
            console.warn(`[TSFutures] Stream error for ${symbol}: ${resp.status}`);
            await new Promise((r) => setTimeout(r, 5000));
            continue;
          }

          const reader = resp.body?.getReader();
          if (!reader) {
            console.warn(`[TSFutures] No stream body for ${symbol}`);
            await new Promise((r) => setTimeout(r, 5000));
            continue;
          }

          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                const quote = JSON.parse(trimmed);
                if (quote.Heartbeat) continue;
                if (quote.Error) {
                  console.warn(`[TSFutures] Stream error for ${symbol}:`, quote.Error);
                  continue;
                }
                this.processQuote(symbol, quote, tickSize);
              } catch {
              }
            }
          }

          console.log(`[TSFutures] Stream ended for ${symbol}, reconnecting...`);
        } catch (err: any) {
          if (err.name === "AbortError") return;
          console.warn(`[TSFutures] Stream connection error for ${symbol}:`, err.message);
        }

        if (this.subscribedSymbols.has(symbol) && !controller.signal.aborted) {
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    };

    connectStream().catch((err) => {
      if (err.name !== "AbortError") {
        console.error(`[TSFutures] Fatal stream error for ${symbol}:`, err.message);
      }
    });
  }

  private processQuote(symbol: string, quote: any, tickSize: number): void {
    const last = parseFloat(quote.Last ?? quote.LastPrice ?? "0");
    const bid = parseFloat(quote.Bid ?? quote.BidPrice ?? "0");
    const ask = parseFloat(quote.Ask ?? quote.AskPrice ?? "0");
    const volume = parseInt(quote.Volume ?? quote.LastSize ?? "0", 10);

    if (last === 0 && bid === 0 && ask === 0) return;

    const tick: FuturesTick = {
      symbol,
      price: last || (bid + ask) / 2,
      bid: bid || last,
      ask: ask || last,
      volume: volume || 1,
      timestamp: Date.now(),
    };
    this.emit("tick", tick);

    const now = Math.floor(Date.now() / 1000);
    const existing = this.barAccumulators.get(symbol);

    if (!existing || existing.time !== now) {
      if (existing) {
        this.emit("bar", { ...existing });
      }
      this.barAccumulators.set(symbol, {
        symbol,
        time: now,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.volume,
      });
    } else {
      existing.high = Math.max(existing.high, tick.price);
      existing.low = Math.min(existing.low, tick.price);
      existing.close = tick.price;
      existing.volume += tick.volume;
    }
  }

  async placeOrder(req: FuturesOrderRequest): Promise<{ brokerOrderId: string }> {
    const tsSymbol = toTSSymbol(req.symbol);
    const accountId = this.config.accountId;
    if (!accountId) throw new Error("No futures account ID configured");

    const tradeAction = req.side === "buy" ? "Buy" : "Sell";
    let orderType = "Market";
    if (req.orderType === "limit") orderType = "Limit";
    else if (req.orderType === "stop") orderType = "StopMarket";

    const body: any = {
      AccountID: accountId,
      Symbol: tsSymbol,
      Quantity: String(req.qty),
      OrderType: orderType,
      TradeAction: tradeAction,
      TimeInForce: { Duration: "DAY" },
      Route: "Intelligent",
    };

    if (req.limitPrice !== undefined && req.orderType === "limit") {
      body.LimitPrice = String(req.limitPrice);
    }
    if (req.stopPrice !== undefined && req.orderType === "stop") {
      body.StopPrice = String(req.stopPrice);
    }

    console.log(`[TSFutures] Placing order: ${tradeAction} ${req.qty} ${tsSymbol} @ ${orderType}`);

    const resp = await fetch(`${this.baseUrl}/orderexecution/orders`, {
      method: "POST",
      headers: {
        ...this.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`TradeStation futures order error ${resp.status}: ${text.substring(0, 300)}`);
    }

    const data = await resp.json();
    if (data?.Errors?.length > 0) {
      throw new Error(`TradeStation futures order rejected: ${data.Errors.map((e: any) => e.Message || e).join("; ")}`);
    }

    const orders = data?.Orders || [];
    const firstOrder = orders[0] || {};
    const brokerOrderId = String(firstOrder.OrderID || data?.OrderID || `TS-FUT-${++this.orderCounter}-${Date.now()}`);

    const acceptUpdate: FuturesOrderUpdate = {
      brokerOrderId,
      symbol: req.symbol,
      side: req.side,
      qty: req.qty,
      status: "accepted",
    };
    this.emit("orderUpdate", acceptUpdate);

    console.log(`[TSFutures] Order placed: ${brokerOrderId}`);
    return { brokerOrderId };
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    console.log(`[TSFutures] Cancelling order: ${brokerOrderId}`);

    const resp = await fetch(`${this.baseUrl}/orderexecution/orders/${brokerOrderId}`, {
      method: "DELETE",
      headers: this.headers,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`TradeStation futures cancel error ${resp.status}: ${text.substring(0, 200)}`);
    }

    console.log(`[TSFutures] Order cancelled: ${brokerOrderId}`);
  }

  updateAccessToken(newToken: string): void {
    this.config.accessToken = newToken;
  }
}
