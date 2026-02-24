import type { BrokerProvider, NormalizedAccount, NormalizedPosition, NormalizedOrder, BrokerStatus, OrderRequest, OrderResponse, OptionQuote } from "../types";

const LIVE_BASE_URL = "https://api.tradestation.com/v3";
const SIM_BASE_URL = "https://sim-api.tradestation.com/v3";

export function getTradeStationBaseUrl(simMode?: boolean): string {
  return simMode ? SIM_BASE_URL : LIVE_BASE_URL;
}

function tsHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
}

async function tsFetch(url: string, accessToken: string): Promise<any> {
  const response = await fetch(url, { headers: tsHeaders(accessToken) });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`TradeStation API error ${response.status}: ${text.substring(0, 200)}`);
  }
  return response.json();
}

const TS_ORDER_TYPE_MAP: Record<string, string> = {
  market: "Market",
  limit: "Limit",
  stop: "StopMarket",
  stop_limit: "StopLimit",
};

const TS_DURATION_MAP: Record<string, string> = {
  day: "DAY",
  gtc: "GTC",
  pre: "DAY",
  post: "DAY",
};

function mapTradeAction(side: "buy" | "sell", optionSide?: string): string {
  if (optionSide) {
    switch (optionSide) {
      case "buy_to_open": return "BuyToOpen";
      case "buy_to_close": return "BuyToClose";
      case "sell_to_open": return "SellToOpen";
      case "sell_to_close": return "SellToClose";
      default: return side === "buy" ? "BuyToOpen" : "SellToClose";
    }
  }
  return side === "buy" ? "Buy" : "Sell";
}

import type { StockQuote, OptionChainContract } from "./tradier";

export async function tsGetBatchQuotes(accessToken: string, symbols: string[]): Promise<Map<string, StockQuote>> {
  const results = new Map<string, StockQuote>();
  const batchSize = 50;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    try {
      const symbolList = batch.join(",");
      const data = await tsFetch(
        `${LIVE_BASE_URL}/marketdata/quotes/${symbolList}`,
        accessToken,
      );
      const quotes = data?.Quotes || [];
      for (const q of quotes) {
        const last = parseFloat(q.Last ?? "0");
        if (q.Symbol && last > 0) {
          const prevClose = parseFloat(q.PreviousClose ?? "0") || last;
          results.set(q.Symbol, {
            symbol: q.Symbol,
            last,
            bid: parseFloat(q.Bid ?? "0") || last,
            ask: parseFloat(q.Ask ?? "0") || last,
            change: parseFloat(q.NetChange ?? "0"),
            changePercent: parseFloat(q.NetChangePct ?? "0") || (prevClose > 0 ? ((last - prevClose) / prevClose) * 100 : 0),
            volume: parseInt(q.Volume ?? "0", 10),
            open: parseFloat(q.Open ?? "0") || last,
            high: parseFloat(q.High ?? "0") || last,
            low: parseFloat(q.Low ?? "0") || last,
            prevClose,
            avgVolume: parseInt(q.AverageVolume ?? "0", 10),
          });
        }
      }
    } catch (e) {
      console.error(`[TradeStation] Batch quote error for ${batch.length} symbols:`, (e as Error).message);
    }
  }
  return results;
}

export async function tsGetOptionExpirations(accessToken: string, symbol: string): Promise<string[]> {
  try {
    const data = await tsFetch(
      `${LIVE_BASE_URL}/marketdata/options/expirations/${encodeURIComponent(symbol)}`,
      accessToken,
    );
    const expirations = data?.Expirations || data || [];
    if (!Array.isArray(expirations)) return [];
    return expirations.map((e: any) => {
      const date = e.Date || e;
      if (typeof date === "string") {
        return date.includes("T") ? date.split("T")[0] : date;
      }
      return String(date);
    }).filter((d: string) => d && d.length >= 10);
  } catch (e) {
    console.error(`[TradeStation] Expirations error for ${symbol}:`, (e as Error).message);
    return [];
  }
}

function parseStreamedJson(text: string): any[] {
  const results: any[] = [];
  const lines = text.split(/\r?\n/);
  let buffer = "";
  let parseErrors = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("END") || trimmed.startsWith("ERROR")) continue;
    if (/^[0-9a-fA-F]+$/.test(trimmed)) continue;
    buffer += trimmed;
    try {
      const obj = JSON.parse(buffer);
      buffer = "";
      if (obj && typeof obj === "object") results.push(obj);
    } catch {
      parseErrors++;
      if (parseErrors > 500) break;
    }
  }
  return results;
}

async function consumeStream(response: Response, timeoutMs: number = 12000): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return await response.text();

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  const deadline = Date.now() + timeoutMs;

  try {
    while (Date.now() < deadline) {
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), Math.max(0, deadline - Date.now()))
        ),
      ]);
      if (done) break;
      if (value) {
        const text = decoder.decode(value, { stream: true });
        chunks.push(text);
        if (text.includes("END") || text.includes("ERROR")) break;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return chunks.join("");
}

export async function tsGetOptionChain(accessToken: string, symbol: string, expiration: string): Promise<OptionChainContract[]> {
  try {
    const url = `${LIVE_BASE_URL}/marketdata/stream/options/chains/${encodeURIComponent(symbol)}?expiration=${expiration}&strikeCount=20&spreadType=Single`;
    const response = await fetch(url, {
      headers: {
        ...tsHeaders(accessToken),
        Accept: "application/vnd.tradestation.streams.v2+json",
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`TradeStation option chain API error ${response.status}: ${text.substring(0, 200)}`);
    }

    const body = await consumeStream(response);
    const items = parseStreamedJson(body);

    if (items.length === 0) {
      console.warn(`[TradeStation] Option chain stream returned 0 parseable items for ${symbol} ${expiration} (body length=${body.length})`);
      return [];
    }

    const contracts: OptionChainContract[] = [];

    for (const o of items) {
      if (o.Heartbeat || o.Error || o.Status) continue;

      const side = (o.Side || "").toLowerCase();
      const optionType: "call" | "put" = side.includes("put") ? "put" : "call";

      const strikes = o.Strikes || [];
      const strike = strikes.length > 0 ? parseFloat(strikes[0]) : 0;
      if (strike <= 0) continue;

      const legs = o.Legs || [];
      const legSymbol = legs.length > 0 ? legs[0].Symbol : "";
      const contractSymbol = o.Symbol || legSymbol || `${symbol} ${expiration}${optionType === "call" ? "C" : "P"}${strike}`;

      const bid = parseFloat(o.Bid ?? "0");
      const ask = parseFloat(o.Ask ?? "0");
      const last = parseFloat(o.Last ?? "0");
      const volume = parseInt(o.Volume ?? "0", 10);
      const openInterest = parseInt(o.DailyOpenInterest ?? "0", 10);
      const delta = parseFloat(o.Delta ?? "0");
      const gamma = parseFloat(o.Gamma ?? "0");
      const theta = parseFloat(o.Theta ?? "0");
      const vega = parseFloat(o.Vega ?? "0");
      const iv = parseFloat(o.ImpliedVolatility ?? "0");

      contracts.push({
        symbol: contractSymbol,
        strike,
        optionType,
        expiration,
        bid,
        ask,
        last,
        volume,
        openInterest,
        greeks: (delta !== 0 || gamma !== 0 || theta !== 0) ? {
          delta,
          gamma,
          theta,
          vega,
          mid_iv: iv,
        } : undefined,
      });
    }

    console.log(`[TradeStation] Option chain for ${symbol} ${expiration}: ${contracts.length} contracts parsed from ${items.length} stream items`);
    return contracts;
  } catch (e) {
    console.error(`[TradeStation] Option chain error for ${symbol} ${expiration}:`, (e as Error).message);
    return [];
  }
}

export const tradestationProvider: BrokerProvider = {
  async getStatus(accessToken: string): Promise<BrokerStatus> {
    const accounts = await tsFetch(`${LIVE_BASE_URL}/brokerage/accounts`, accessToken);
    const accountList = accounts?.Accounts || accounts || [];
    const first = Array.isArray(accountList) ? accountList[0] : null;
    return {
      connected: true,
      provider: "tradestation",
      accountId: first?.AccountID ?? undefined,
    };
  },

  async getAccounts(accessToken: string): Promise<NormalizedAccount[]> {
    const data = await tsFetch(`${LIVE_BASE_URL}/brokerage/accounts`, accessToken);
    const accountList = data?.Accounts || data || [];
    if (!Array.isArray(accountList)) return [];

    const results: NormalizedAccount[] = [];
    for (const acct of accountList) {
      let balances: any = null;
      try {
        const balData = await tsFetch(
          `${LIVE_BASE_URL}/brokerage/accounts/${acct.AccountID}/balances`,
          accessToken,
        );
        balances = balData?.Balances?.[0] || balData;
      } catch {
      }

      results.push({
        id: acct.AccountID ?? "",
        name: acct.DisplayName || acct.Alias || acct.AccountID || "TradeStation Account",
        type: acct.AccountType || "unknown",
        buyingPower: parseFloat(balances?.BuyingPower ?? balances?.OptionBuyingPower ?? "0") || 0,
        equity: parseFloat(balances?.Equity ?? balances?.AccountBalance ?? "0") || 0,
        currency: balances?.Currency || "USD",
      });
    }

    return results;
  },

  async getPositions(accessToken: string, accountId?: string): Promise<NormalizedPosition[]> {
    if (!accountId) {
      const status = await this.getStatus(accessToken);
      accountId = status.accountId;
    }
    if (!accountId) return [];

    const data = await tsFetch(
      `${LIVE_BASE_URL}/brokerage/accounts/${accountId}/positions`,
      accessToken,
    );

    const positions = data?.Positions || data || [];
    if (!Array.isArray(positions)) return [];

    return positions.map((p: any) => ({
      symbol: p.Symbol || "",
      qty: parseFloat(p.Quantity ?? "0"),
      avgPrice: parseFloat(p.AveragePrice ?? "0"),
      marketPrice: parseFloat(p.Last ?? p.MarketValue ?? "0"),
      unrealizedPnl: parseFloat(p.UnrealizedProfitLoss ?? "0"),
    }));
  },

  async getOrders(accessToken: string, accountId?: string): Promise<NormalizedOrder[]> {
    if (!accountId) {
      const status = await this.getStatus(accessToken);
      accountId = status.accountId;
    }
    if (!accountId) return [];

    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const allOrders: any[] = [];

    try {
      const activeData = await tsFetch(
        `${LIVE_BASE_URL}/brokerage/accounts/${accountId}/orders?since=${encodeURIComponent(since)}`,
        accessToken,
      );
      const activeOrders = activeData?.Orders || activeData || [];
      if (Array.isArray(activeOrders)) {
        allOrders.push(...activeOrders);
        console.log(`[TradeStation] getOrders: ${activeOrders.length} active orders for account ${accountId}`);
      }
    } catch (err: any) {
      console.log(`[TradeStation] getOrders active error: ${err.message}`);
    }

    try {
      const histData = await tsFetch(
        `${LIVE_BASE_URL}/brokerage/accounts/${accountId}/historicalorders?since=${encodeURIComponent(since)}`,
        accessToken,
      );
      const histOrders = histData?.Orders || histData || [];
      if (Array.isArray(histOrders)) {
        allOrders.push(...histOrders);
        console.log(`[TradeStation] getOrders: ${histOrders.length} historical orders for account ${accountId}`);
      }
    } catch (err: any) {
      console.log(`[TradeStation] getOrders historical error: ${err.message}`);
    }

    if (allOrders.length === 0) {
      console.log(`[TradeStation] getOrders: no orders found for account ${accountId}`);
      return [];
    }

    const deduped = Array.from(
      new Map(allOrders.map((o: any) => [String(o.OrderID || ""), o])).values()
    );

    console.log(`[TradeStation] getOrders: ${deduped.length} total unique orders for account ${accountId}`);

    return deduped.slice(0, 500).map((o: any) => {
      const action = (o.TradeAction || o.Legs?.[0]?.BuyOrSell || "").toLowerCase();
      const isSell = action.includes("sell") || action === "sellshort" || action === "selltoclose" || action === "selltoopen";
      const rawType = (o.OrderType || "").toLowerCase();
      let orderType: string = "market";
      if (rawType.includes("stoplimit")) orderType = "stop_limit";
      else if (rawType.includes("stop")) orderType = "stop";
      else if (rawType.includes("limit")) orderType = "limit";
      else if (rawType.includes("market")) orderType = "market";

      const stopPrice = parseFloat(o.StopPrice || "0") || null;
      const limitPrice = parseFloat(o.LimitPrice || "0") || null;
      const filledPrice = parseFloat(o.FilledPrice || "0") || null;

      let legType: string | undefined;
      const groupType = (o.GroupName || o.OrderType || "").toLowerCase();
      if (groupType.includes("oco") || groupType.includes("bracket")) {
        if (orderType === "stop" || orderType === "stop_limit") {
          legType = "stop_loss";
        } else if (orderType === "limit") {
          legType = "profit_target";
        }
      }
      if (orderType === "stop" && !legType) {
        legType = "stop_loss";
      }

      return {
        id: String(o.OrderID || ""),
        symbol: o.Legs?.[0]?.Symbol || o.Symbol || "UNKNOWN",
        side: isSell ? "sell" as const : "buy" as const,
        qty: parseInt(o.Legs?.[0]?.QuantityOrdered || o.Quantity || "0", 10),
        filledQty: parseInt(o.Legs?.[0]?.ExecQuantity || o.FilledQuantity || "0", 10),
        price: filledPrice || limitPrice || stopPrice,
        stopPrice,
        limitPrice,
        status: o.Status || o.StatusDescription || "unknown",
        createdAt: o.OpenedDateTime || o.ClosedDateTime || "",
        orderType,
        groupOrderId: o.GroupName || undefined,
        groupOrderType: groupType || undefined,
        legType,
        duration: o.Duration || o.TimeInForce || undefined,
      };
    });
  },

  async getOptionQuote(accessToken: string, optionSymbol: string): Promise<OptionQuote | null> {
    try {
      const data = await tsFetch(
        `${LIVE_BASE_URL}/marketdata/quotes/${encodeURIComponent(optionSymbol)}`,
        accessToken,
      );
      const quotes = data?.Quotes || data || [];
      const quote = Array.isArray(quotes) ? quotes[0] : quotes;
      if (!quote) return null;
      const bid = parseFloat(quote.Bid ?? "0");
      const ask = parseFloat(quote.Ask ?? "0");
      return {
        symbol: optionSymbol,
        bid,
        ask,
        mid: parseFloat(((bid + ask) / 2).toFixed(2)),
        last: parseFloat(quote.Last ?? "0"),
        volume: parseInt(quote.Volume ?? "0", 10),
        openInterest: parseInt(quote.OpenInterest ?? "0", 10),
      };
    } catch (e) {
      console.error("[TradeStation] getOptionQuote error:", (e as Error).message);
      return null;
    }
  },

  async placeOrder(accessToken: string, order: OrderRequest): Promise<OrderResponse> {
    const isOption = order.orderClass === "option" && order.optionSymbol;

    const body: any = {
      AccountID: order.accountId,
      Symbol: isOption ? order.optionSymbol : order.symbol,
      Quantity: String(order.quantity),
      OrderType: TS_ORDER_TYPE_MAP[order.orderType] || "Limit",
      TradeAction: isOption
        ? mapTradeAction(order.side, order.optionSide)
        : mapTradeAction(order.side),
      TimeInForce: {
        Duration: TS_DURATION_MAP[order.duration] || "DAY",
      },
    };

    if (order.price !== undefined && (order.orderType === "limit" || order.orderType === "stop_limit")) {
      body.LimitPrice = String(order.price);
    }
    if ((order.stopPrice !== undefined) && (order.orderType === "stop" || order.orderType === "stop_limit")) {
      body.StopPrice = String(order.stopPrice);
    }

    console.log(`[TradeStation] Placing order:`, JSON.stringify(body).substring(0, 500));

    const response = await fetch(`${LIVE_BASE_URL}/orderexecution/orders`, {
      method: "POST",
      headers: {
        ...tsHeaders(accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`TradeStation order error ${response.status}: ${text.substring(0, 300)}`);
    }

    const data = await response.json();
    console.log(`[TradeStation] Order response:`, JSON.stringify(data).substring(0, 500));

    if (data?.Errors && data.Errors.length > 0) {
      throw new Error(`TradeStation order rejected: ${data.Errors.map((e: any) => e.Message || e).join("; ")}`);
    }

    const orders = data?.Orders || [];
    const firstOrder = orders[0] || {};
    const orderId = String(firstOrder.OrderID || data?.OrderID || "pending");

    return {
      orderId,
      symbol: isOption ? (order.optionSymbol || order.symbol) : order.symbol,
      side: order.side,
      quantity: order.quantity,
      status: firstOrder.Status || "pending",
    };
  },

  async cancelOrder(accessToken: string, orderId: string): Promise<{ success: boolean; message: string }> {
    const response = await fetch(`${LIVE_BASE_URL}/orderexecution/orders/${orderId}`, {
      method: "DELETE",
      headers: tsHeaders(accessToken),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { success: false, message: `TradeStation cancel error ${response.status}: ${text.substring(0, 200)}` };
    }

    console.log(`[TradeStation] Cancel order ${orderId}: success`);
    return { success: true, message: `Order ${orderId} cancelled` };
  },
};
