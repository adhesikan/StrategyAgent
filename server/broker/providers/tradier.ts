import type { BrokerProvider, NormalizedAccount, NormalizedPosition, NormalizedOrder, BrokerStatus, OrderRequest, OrderResponse, OptionQuote } from "../types";

const BASE_URL = "https://api.tradier.com/v1";

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

export const tradierProvider: BrokerProvider = {
  async getStatus(accessToken: string): Promise<BrokerStatus> {
    const data = await tradierFetch(`${BASE_URL}/user/profile`, accessToken);
    const account = data?.profile?.account;
    const firstAccount = Array.isArray(account) ? account[0] : account;
    return {
      connected: true,
      provider: "tradier",
      accountId: firstAccount?.account_number ?? undefined,
    };
  },

  async getAccounts(accessToken: string): Promise<NormalizedAccount[]> {
    const data = await tradierFetch(`${BASE_URL}/user/profile`, accessToken);
    const accounts = data?.profile?.account;
    if (!accounts) return [];

    const accountArray = Array.isArray(accounts) ? accounts : [accounts];

    const results: NormalizedAccount[] = [];
    for (const acct of accountArray) {
      let balances: any = null;
      try {
        const balData = await tradierFetch(
          `${BASE_URL}/accounts/${acct.account_number}/balances`,
          accessToken,
        );
        balances = balData?.balances;
      } catch {
      }

      results.push({
        id: acct.account_number ?? acct.id ?? "",
        name: acct.name || acct.account_number || "Tradier Account",
        type: acct.type || acct.classification || "unknown",
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
      `${BASE_URL}/accounts/${accountId}/positions`,
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
      `${BASE_URL}/accounts/${accountId}/orders`,
      accessToken,
    );

    const orders = data?.orders?.order;
    if (!orders) return [];

    const orderArray = Array.isArray(orders) ? orders : [orders];

    return orderArray.slice(0, 50).map((o: any) => ({
      id: String(o.id),
      symbol: o.symbol || (o.leg?.[0]?.symbol) || "UNKNOWN",
      side: (o.side === "sell" || o.side === "sell_short") ? "sell" as const : "buy" as const,
      qty: o.quantity ?? 0,
      status: o.status ?? "unknown",
      createdAt: o.create_date ?? o.transaction_date ?? "",
    }));
  },

  async getOptionQuote(accessToken: string, optionSymbol: string): Promise<OptionQuote | null> {
    try {
      const data = await tradierFetch(
        `${BASE_URL}/markets/quotes?symbols=${encodeURIComponent(optionSymbol)}&greeks=false`,
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
    const params = new URLSearchParams();
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

    console.log(`[Tradier] Order params: ${params.toString()}`);

    const response = await fetch(
      `${BASE_URL}/accounts/${order.accountId}/orders`,
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
};
