import type { BrokerProvider, NormalizedAccount, NormalizedPosition, NormalizedOrder, BrokerStatus, OrderRequest, OrderResponse, OptionQuote } from "../types";

const BASE_URL = "https://api.tradier.com/v1";
const SANDBOX_URL = "https://sandbox.tradier.com/v1";

const sandboxTokens = new Set<string>();

export function registerSandboxToken(token: string): void {
  sandboxTokens.add(token);
}

function getBaseUrlForToken(token: string): string {
  return sandboxTokens.has(token) ? SANDBOX_URL : BASE_URL;
}

function getAccountBaseUrl(account: any): string {
  const classification = (account.classification || account.type || "").toLowerCase();
  if (classification === "paper" || classification === "sandbox" || classification === "virtual") {
    return SANDBOX_URL;
  }
  return BASE_URL;
}

function tradierHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
}

async function tradierFetch(url: string, accessToken: string): Promise<any> {
  const response = await fetch(url, { headers: tradierHeaders(accessToken) });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Tradier API error ${response.status}: ${text.substring(0, 200)}`);
  }
  return response.json();
}

const TRADIER_ORDER_TYPE_MAP: Record<string, string> = {
  market: "market",
  limit: "limit",
  stop: "stop",
  stop_limit: "stop_limit",
};

const TRADIER_DURATION_MAP: Record<string, string> = {
  day: "day",
  gtc: "gtc",
  pre: "pre",
  post: "post",
};

export interface StockQuote {
  symbol: string;
  last: number;
  bid: number;
  ask: number;
  change: number;
  changePercent: number;
  volume: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  avgVolume: number;
}

export interface OptionChainContract {
  symbol: string;
  strike: number;
  optionType: "call" | "put";
  expiration: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  openInterest: number;
  greeks?: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    mid_iv: number;
  };
}

export async function tradierGetBatchQuotes(accessToken: string, symbols: string[]): Promise<Map<string, StockQuote>> {
  const results = new Map<string, StockQuote>();
  const batchSize = 100;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    try {
      const data = await tradierFetch(
        `${getBaseUrlForToken(accessToken)}/markets/quotes?symbols=${batch.join(",")}&greeks=false`,
        accessToken,
      );
      const quotes = data?.quotes?.quote;
      if (!quotes) continue;
      const arr = Array.isArray(quotes) ? quotes : [quotes];
      for (const q of arr) {
        if (q.symbol && typeof q.last === "number") {
          const prevClose = q.prevclose ?? q.close ?? q.last;
          results.set(q.symbol, {
            symbol: q.symbol,
            last: q.last,
            bid: q.bid ?? q.last,
            ask: q.ask ?? q.last,
            change: q.change ?? 0,
            changePercent: q.change_percentage ?? (prevClose > 0 ? ((q.last - prevClose) / prevClose) * 100 : 0),
            volume: q.volume ?? 0,
            open: q.open ?? q.last,
            high: q.high ?? q.last,
            low: q.low ?? q.last,
            prevClose,
            avgVolume: q.average_volume ?? 0,
          });
        }
      }
    } catch (e) {
      console.error(`[Tradier] Batch quote error for ${batch.length} symbols:`, (e as Error).message);
    }
  }
  return results;
}

export async function tradierGetOptionExpirations(accessToken: string, symbol: string): Promise<string[]> {
  try {
    const data = await tradierFetch(
      `${getBaseUrlForToken(accessToken)}/markets/options/expirations?symbol=${encodeURIComponent(symbol)}&includeAllRoots=false&strikes=false`,
      accessToken,
    );
    const exps = data?.expirations?.date;
    if (!exps) return [];
    return Array.isArray(exps) ? exps : [exps];
  } catch (e) {
    console.error(`[Tradier] Expirations error for ${symbol}:`, (e as Error).message);
    return [];
  }
}

export async function tradierGetOptionChain(accessToken: string, symbol: string, expiration: string): Promise<OptionChainContract[]> {
  try {
    const data = await tradierFetch(
      `${getBaseUrlForToken(accessToken)}/markets/options/chains?symbol=${encodeURIComponent(symbol)}&expiration=${expiration}&greeks=true`,
      accessToken,
    );
    const options = data?.options?.option;
    if (!options) return [];
    const arr = Array.isArray(options) ? options : [options];
    return arr.map((o: any) => ({
      symbol: o.symbol,
      strike: o.strike,
      optionType: o.option_type === "call" ? "call" as const : "put" as const,
      expiration: o.expiration_date,
      bid: o.bid ?? 0,
      ask: o.ask ?? 0,
      last: o.last ?? 0,
      volume: o.volume ?? 0,
      openInterest: o.open_interest ?? 0,
      greeks: o.greeks ? {
        delta: o.greeks.delta ?? 0,
        gamma: o.greeks.gamma ?? 0,
        theta: o.greeks.theta ?? 0,
        vega: o.greeks.vega ?? 0,
        mid_iv: o.greeks.mid_iv ?? 0,
      } : undefined,
    }));
  } catch (e) {
    console.error(`[Tradier] Option chain error for ${symbol} ${expiration}:`, (e as Error).message);
    return [];
  }
}

export const tradierProvider: BrokerProvider = {
  async getStatus(accessToken: string): Promise<BrokerStatus> {
    const data = await tradierFetch(`${getBaseUrlForToken(accessToken)}/user/profile`, accessToken);
    const account = data?.profile?.account;
    const firstAccount = Array.isArray(account) ? account[0] : account;
    return {
      connected: true,
      provider: "tradier",
      accountId: firstAccount?.account_number ?? undefined,
    };
  },

  async getAccounts(accessToken: string): Promise<NormalizedAccount[]> {
    const baseUrl = getBaseUrlForToken(accessToken);
    const data = await tradierFetch(`${baseUrl}/user/profile`, accessToken);
    const accounts = data?.profile?.account;
    if (!accounts) return [];

    const accountArray = Array.isArray(accounts) ? accounts : [accounts];
    console.log(`[Tradier] Found ${accountArray.length} accounts:`, accountArray.map((a: any) => ({ id: a.account_number, type: a.type, classification: a.classification, status: a.status })));

    const results: NormalizedAccount[] = [];
    for (const acct of accountArray) {
      let balances: any = null;
      const acctBaseUrl = getAccountBaseUrl(acct);
      try {
        const balData = await tradierFetch(
          `${acctBaseUrl}/accounts/${acct.account_number}/balances`,
          accessToken,
        );
        balances = balData?.balances;
      } catch {
      }

      const classification = (acct.classification || acct.type || "").toLowerCase();
      const isPaper = classification === "paper" || classification === "sandbox" || classification === "virtual";
      const displayType = isPaper ? "paper" : (acct.type || acct.classification || "unknown");

      results.push({
        id: acct.account_number ?? acct.id ?? "",
        name: acct.name || acct.account_number || "Tradier Account",
        type: displayType,
        buyingPower: balances?.margin?.option_buying_power ?? balances?.cash?.cash_available ?? balances?.buying_power ?? 0,
        equity: balances?.total_equity ?? balances?.equity ?? 0,
        currency: "USD",
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

    const data = await tradierFetch(
      `${getBaseUrlForToken(accessToken)}/accounts/${accountId}/positions`,
      accessToken,
    );

    const positions = data?.positions?.position;
    if (!positions) return [];

    const posArray = Array.isArray(positions) ? positions : [positions];

    return posArray.map((p: any) => ({
      symbol: p.symbol,
      qty: p.quantity ?? 0,
      avgPrice: p.cost_basis ? p.cost_basis / (p.quantity || 1) : 0,
      marketPrice: p.last ?? 0,
      unrealizedPnl: (p.last ?? 0) * (p.quantity ?? 0) - (p.cost_basis ?? 0),
    }));
  },

  async getOrders(accessToken: string, accountId?: string): Promise<NormalizedOrder[]> {
    if (!accountId) {
      const status = await this.getStatus(accessToken);
      accountId = status.accountId;
    }
    if (!accountId) return [];

    const data = await tradierFetch(
      `${getBaseUrlForToken(accessToken)}/accounts/${accountId}/orders?includeTags=true`,
      accessToken,
    );

    const orders = data?.orders?.order;
    if (!orders) {
      console.log(`[Tradier] getOrders: no orders returned for account ${accountId}`);
      return [];
    }

    const orderArray = Array.isArray(orders) ? orders : [orders];
    console.log(`[Tradier] getOrders: found ${orderArray.length} orders for account ${accountId}`);

    const flatOrders: NormalizedOrder[] = [];
    for (const o of orderArray.slice(0, 500)) {
      const rawClass = (o.class || "").toLowerCase();
      const rawType = (o.type || "").toLowerCase();
      let orderType: string = "market";
      if (rawType === "stop_limit") orderType = "stop_limit";
      else if (rawType === "stop") orderType = "stop";
      else if (rawType === "limit") orderType = "limit";
      else if (rawType === "market") orderType = "market";

      if (rawClass === "oco" || rawClass === "otoco") {
        const legs = o.leg ? (Array.isArray(o.leg) ? o.leg : [o.leg]) : [];
        if (legs.length > 0) {
          for (const leg of legs) {
            const legType_ = (leg.type || "").toLowerCase();
            let legOrderType: string = "market";
            if (legType_ === "stop_limit") legOrderType = "stop_limit";
            else if (legType_ === "stop") legOrderType = "stop";
            else if (legType_ === "limit") legOrderType = "limit";
            else if (legType_ === "market") legOrderType = "market";

            let legRole: string | undefined;
            if (legOrderType === "stop" || legOrderType === "stop_limit") {
              legRole = "stop_loss";
            } else if (legOrderType === "limit") {
              legRole = "profit_target";
            }

            flatOrders.push({
              id: String(leg.id || o.id),
              symbol: leg.symbol || o.symbol || "UNKNOWN",
              side: (leg.side === "sell" || leg.side === "sell_short") ? "sell" as const : "buy" as const,
              action: leg.side || o.side || undefined,
              qty: leg.quantity ?? o.quantity ?? 0,
              filledQty: leg.exec_quantity ?? leg.last_fill_quantity ?? 0,
              price: leg.avg_fill_price ?? leg.price ?? null,
              stopPrice: leg.stop_price ?? null,
              limitPrice: leg.price ?? null,
              status: leg.status ?? o.status ?? "unknown",
              createdAt: o.create_date ?? o.transaction_date ?? "",
              orderType: legOrderType,
              groupOrderId: String(o.id),
              groupOrderType: rawClass,
              legType: legRole,
              duration: o.duration ?? undefined,
            });
          }
          continue;
        }
      }

      let legType: string | undefined;
      if (orderType === "stop" || orderType === "stop_limit") {
        legType = "stop_loss";
      }

      flatOrders.push({
        id: String(o.id),
        symbol: o.symbol || (o.leg?.[0]?.symbol) || "UNKNOWN",
        side: (o.side === "sell" || o.side === "sell_short") ? "sell" as const : "buy" as const,
        action: o.side || undefined,
        qty: o.quantity ?? 0,
        filledQty: o.exec_quantity ?? o.last_fill_quantity ?? 0,
        price: o.avg_fill_price ?? o.price ?? null,
        stopPrice: o.stop_price ?? null,
        limitPrice: o.price ?? null,
        status: o.status ?? "unknown",
        createdAt: o.create_date ?? o.transaction_date ?? "",
        orderType,
        legType,
        duration: o.duration ?? undefined,
      });
    }
    return flatOrders;
  },

  async getOptionQuote(accessToken: string, optionSymbol: string): Promise<OptionQuote | null> {
    try {
      const data = await tradierFetch(
        `${getBaseUrlForToken(accessToken)}/markets/quotes?symbols=${encodeURIComponent(optionSymbol)}&greeks=false`,
        accessToken,
      );
      const quote = data?.quotes?.quote;
      if (!quote) return null;
      const bid = quote.bid ?? 0;
      const ask = quote.ask ?? 0;
      return {
        symbol: optionSymbol,
        bid,
        ask,
        mid: parseFloat(((bid + ask) / 2).toFixed(2)),
        last: quote.last ?? 0,
        volume: quote.volume ?? 0,
        openInterest: quote.open_interest ?? 0,
      };
    } catch (e) {
      console.error("[Tradier] getOptionQuote error:", (e as Error).message);
      return null;
    }
  },

  async placeOrder(accessToken: string, order: OrderRequest): Promise<OrderResponse> {
    const isOption = order.orderClass === "option" && order.optionSymbol;
    const isBracket = order.orderClass === "otoco" && order.bracketTarget && order.bracketStop;
    const params = new URLSearchParams();

    if (isBracket) {
      params.set("class", "otoco");
      params.set("duration", TRADIER_DURATION_MAP[order.duration] || "day");
      params.set("type[0]", TRADIER_ORDER_TYPE_MAP[order.orderType] || "market");
      params.set("symbol[0]", order.symbol);
      params.set("quantity[0]", String(order.quantity));
      params.set("side[0]", order.side === "buy" ? "buy" : "sell");
      if (order.price !== undefined && (order.orderType === "limit" || order.orderType === "stop_limit")) {
        params.set("price[0]", String(order.price));
      }

      const exitSide = order.side === "buy" ? "sell" : "buy";
      params.set("type[1]", "limit");
      params.set("symbol[1]", order.symbol);
      params.set("quantity[1]", String(order.quantity));
      params.set("side[1]", exitSide);
      params.set("price[1]", String(order.bracketTarget));

      params.set("type[2]", "stop");
      params.set("symbol[2]", order.symbol);
      params.set("quantity[2]", String(order.quantity));
      params.set("side[2]", exitSide);
      params.set("stop[2]", String(order.bracketStop));
    } else {
      params.set("class", isOption ? "option" : "equity");
      params.set("symbol", order.symbol);
      params.set("quantity", String(order.quantity));
      params.set("type", TRADIER_ORDER_TYPE_MAP[order.orderType] || "limit");
      params.set("duration", TRADIER_DURATION_MAP[order.duration] || "day");

      if (isOption) {
        params.set("option_symbol", order.optionSymbol!);
        params.set("side", order.optionSide || "buy_to_open");
      } else {
        params.set("side", order.side === "buy" ? "buy" : "sell");
      }

      if (order.price !== undefined && (order.orderType === "limit" || order.orderType === "stop_limit")) {
        params.set("price", String(order.price));
      }
      if (order.stopPrice !== undefined && (order.orderType === "stop" || order.orderType === "stop_limit")) {
        params.set("stop", String(order.stopPrice));
      }
    }

    console.log(`[Tradier] Order params: ${params.toString()}`);

    const response = await fetch(
      `${getBaseUrlForToken(accessToken)}/accounts/${order.accountId}/orders`,
      {
        method: "POST",
        headers: {
          ...tradierHeaders(accessToken),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Tradier order error ${response.status}: ${text.substring(0, 300)}`);
    }

    const data = await response.json();
    console.log(`[Tradier] Order response:`, JSON.stringify(data).substring(0, 500));

    if (data?.errors) {
      const errMsg = typeof data.errors === "string" ? data.errors
        : data.errors?.error ? (Array.isArray(data.errors.error) ? data.errors.error.join("; ") : data.errors.error)
        : JSON.stringify(data.errors);
      throw new Error(`Tradier order rejected: ${errMsg}`);
    }

    const orderId = data?.order?.id ? String(data.order.id) : "pending";
    const orderStatus = data?.order?.status || "pending";

    if (orderId === "pending") {
      console.warn(`[Tradier] Order placed but no order ID returned. Full response:`, JSON.stringify(data));
    }

    return {
      orderId,
      symbol: isOption ? (order.optionSymbol || order.symbol) : order.symbol,
      side: order.side,
      quantity: order.quantity,
      status: orderStatus,
    };
  },

  async cancelOrder(accessToken: string, orderId: string, accountId?: string): Promise<{ success: boolean; message: string }> {
    if (!accountId) {
      const accounts = await tradierProvider.getAccounts(accessToken);
      accountId = accounts[0]?.id;
    }
    if (!accountId) {
      return { success: false, message: "No account found" };
    }

    const baseUrl = getBaseUrlForToken(accessToken);
    const response = await fetch(
      `${baseUrl}/accounts/${accountId}/orders/${orderId}`,
      {
        method: "DELETE",
        headers: tradierHeaders(accessToken),
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { success: false, message: `Tradier cancel error ${response.status}: ${text.substring(0, 200)}` };
    }

    const data = await response.json();
    console.log(`[Tradier] Cancel order ${orderId} response:`, JSON.stringify(data).substring(0, 300));

    if (data?.order?.status === "ok" || response.ok) {
      return { success: true, message: `Order ${orderId} cancelled` };
    }

    return { success: false, message: data?.errors?.error || "Unknown error cancelling order" };
  },
};

export interface HistoricalBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function tradierGetHistoricalBars(
  accessToken: string,
  symbol: string,
  options: { interval?: "daily" | "weekly" | "monthly"; lookbackDays?: number } = {},
): Promise<HistoricalBar[]> {
  const interval = options.interval ?? "daily";
  const lookbackDays = options.lookbackDays ?? 200;
  const end = new Date();
  const start = new Date(end.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  try {
    const data = await tradierFetch(
      `${getBaseUrlForToken(accessToken)}/markets/history?symbol=${encodeURIComponent(symbol)}&interval=${interval}&start=${fmt(start)}&end=${fmt(end)}`,
      accessToken,
    );
    const days = data?.history?.day;
    if (!days) return [];
    const arr = Array.isArray(days) ? days : [days];
    return arr.map((d: any) => ({
      timestamp: d.date,
      open: Number(d.open) || 0,
      high: Number(d.high) || 0,
      low: Number(d.low) || 0,
      close: Number(d.close) || 0,
      volume: Number(d.volume) || 0,
    })).filter((b) => b.close > 0);
  } catch (e) {
    console.error(`[Tradier] History error for ${symbol}:`, (e as Error).message);
    return [];
  }
}

export async function tradierGetIntradayBars(
  accessToken: string,
  symbol: string,
  intervalMinutes: 1 | 5 | 15 = 15,
): Promise<HistoricalBar[]> {
  const end = new Date();
  const start = new Date(end.getTime() - 5 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");
  try {
    const data = await tradierFetch(
      `${getBaseUrlForToken(accessToken)}/markets/timesales?symbol=${encodeURIComponent(symbol)}&interval=${intervalMinutes}min&start=${encodeURIComponent(fmt(start))}&end=${encodeURIComponent(fmt(end))}&session_filter=open`,
      accessToken,
    );
    const data2 = data?.series?.data;
    if (!data2) return [];
    const arr = Array.isArray(data2) ? data2 : [data2];
    return arr.map((d: any) => ({
      timestamp: d.time,
      open: Number(d.open) || 0,
      high: Number(d.high) || 0,
      low: Number(d.low) || 0,
      close: Number(d.close ?? d.price) || 0,
      volume: Number(d.volume) || 0,
    })).filter((b) => b.close > 0);
  } catch (e) {
    console.error(`[Tradier] Intraday error for ${symbol}:`, (e as Error).message);
    return [];
  }
}
