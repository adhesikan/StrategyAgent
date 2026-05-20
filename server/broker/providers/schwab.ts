import type { BrokerProvider, NormalizedAccount, NormalizedPosition, NormalizedOrder, BrokerStatus, OrderRequest, OrderResponse, OptionQuote } from "../types";

const BASE_URL = "https://api.schwabapi.com";
const TRADER_URL = `${BASE_URL}/trader/v1`;
const MARKET_URL = `${BASE_URL}/marketdata/v1`;

export const SCHWAB_OAUTH_AUTHORIZE_URL = `${BASE_URL}/v1/oauth/authorize`;
export const SCHWAB_OAUTH_TOKEN_URL = `${BASE_URL}/v1/oauth/token`;

function schwabHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
}

async function schwabFetch(url: string, accessToken: string): Promise<any> {
  const response = await fetch(url, { headers: schwabHeaders(accessToken) });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const err: any = new Error(`Schwab API error ${response.status}: ${text.substring(0, 200)}`);
    err.status = response.status;
    throw err;
  }
  return response.json();
}

/**
 * Authenticated Schwab API fetch with one automatic refresh-and-retry on
 * 401/403. Resolves the access token via the centralized broker helpers so
 * proactive refresh-before-expiry is also applied.
 */
export async function schwabFetchAuthed(userId: string, url: string): Promise<any> {
  const { getValidBrokerAccessToken, forceRefreshBrokerToken } = await import("../index");
  let token = await getValidBrokerAccessToken(userId, "schwab");
  if (!token) {
    const err: any = new Error("Schwab connection requires re-authentication");
    err.status = 401;
    err.requiresReauth = true;
    throw err;
  }
  try {
    return await schwabFetch(url, token);
  } catch (e: any) {
    if (e?.status === 401 || e?.status === 403) {
      const refreshed = await forceRefreshBrokerToken(userId, "schwab");
      if (!refreshed) {
        const err: any = new Error("Schwab token refresh failed — re-auth required");
        err.status = 401;
        err.requiresReauth = true;
        throw err;
      }
      return await schwabFetch(url, refreshed);
    }
    throw e;
  }
}

// Resolve a "displayable" accountNumber or hash to the API's accountHash.
// Schwab uses an opaque hashValue in URLs and the human-readable accountNumber elsewhere.
async function resolveAccountHash(accessToken: string, idOrHash?: string): Promise<string | undefined> {
  if (!idOrHash) {
    const numbers = await schwabFetch(`${TRADER_URL}/accounts/accountNumbers`, accessToken);
    const first = Array.isArray(numbers) ? numbers[0] : null;
    return first?.hashValue;
  }
  // hashValues are long random strings; accountNumbers are short numeric.
  if (idOrHash.length > 12 && /^[A-Za-z0-9_\-=]+$/.test(idOrHash)) {
    return idOrHash;
  }
  try {
    const numbers = await schwabFetch(`${TRADER_URL}/accounts/accountNumbers`, accessToken);
    if (Array.isArray(numbers)) {
      const match = numbers.find((n: any) => String(n.accountNumber) === String(idOrHash));
      if (match?.hashValue) return match.hashValue;
    }
  } catch {}
  return idOrHash;
}

function mapInstruction(side: OrderRequest["side"], isOption: boolean, optionSide?: OrderRequest["optionSide"]): string {
  if (isOption) {
    switch (optionSide) {
      case "buy_to_open": return "BUY_TO_OPEN";
      case "buy_to_close": return "BUY_TO_CLOSE";
      case "sell_to_open": return "SELL_TO_OPEN";
      case "sell_to_close": return "SELL_TO_CLOSE";
      default: return side === "buy" ? "BUY_TO_OPEN" : "SELL_TO_CLOSE";
    }
  }
  return side === "buy" ? "BUY" : "SELL";
}

function mapOrderType(t: OrderRequest["orderType"]): string {
  switch (t) {
    case "market": return "MARKET";
    case "limit": return "LIMIT";
    case "stop": return "STOP";
    case "stop_limit": return "STOP_LIMIT";
    default: return "MARKET";
  }
}

function mapDuration(d: OrderRequest["duration"]): string {
  switch (d) {
    case "gtc": return "GOOD_TILL_CANCEL";
    case "pre":
    case "post":
    case "day":
    default: return "DAY";
  }
}

export const schwabProvider: BrokerProvider = {
  async getStatus(accessToken: string): Promise<BrokerStatus> {
    const numbers = await schwabFetch(`${TRADER_URL}/accounts/accountNumbers`, accessToken);
    const first = Array.isArray(numbers) ? numbers[0] : null;
    return {
      connected: true,
      provider: "schwab" as any,
      accountId: first?.hashValue ?? undefined,
    };
  },

  async getAccounts(accessToken: string): Promise<NormalizedAccount[]> {
    const data = await schwabFetch(`${TRADER_URL}/accounts`, accessToken);
    if (!Array.isArray(data)) return [];
    return data.map((entry: any) => {
      const sa = entry?.securitiesAccount ?? entry;
      const balances = sa?.currentBalances ?? sa?.initialBalances ?? {};
      return {
        id: sa?.hashValue ?? sa?.accountNumber ?? "",
        name: sa?.accountNumber ? `Schwab ${sa.accountNumber}` : "Schwab Account",
        type: (sa?.type || "unknown").toLowerCase(),
        buyingPower: Number(balances?.buyingPower ?? balances?.cashAvailableForTrading ?? 0) || 0,
        equity: Number(balances?.liquidationValue ?? balances?.equity ?? 0) || 0,
        currency: "USD",
      };
    });
  },

  async getPositions(accessToken: string, accountId?: string): Promise<NormalizedPosition[]> {
    const hash = await resolveAccountHash(accessToken, accountId);
    if (!hash) return [];
    const data = await schwabFetch(`${TRADER_URL}/accounts/${encodeURIComponent(hash)}?fields=positions`, accessToken);
    const sa = data?.securitiesAccount ?? data;
    const positions = sa?.positions || [];
    if (!Array.isArray(positions)) return [];
    return positions.map((p: any) => {
      const longQty = Number(p?.longQuantity ?? 0);
      const shortQty = Number(p?.shortQuantity ?? 0);
      const qty = longQty - shortQty;
      const avgPrice = Number(p?.averagePrice ?? 0);
      const marketPrice = Number(p?.marketValue ?? 0) && qty !== 0 ? Number(p.marketValue) / qty : Number(p?.instrument?.netChange ?? 0);
      const unrealizedPnl = Number(p?.currentDayProfitLoss ?? p?.longOpenProfitLoss ?? 0);
      return {
        symbol: p?.instrument?.symbol || "",
        qty,
        avgPrice,
        marketPrice,
        unrealizedPnl,
      };
    });
  },

  async getOrders(accessToken: string, accountId?: string): Promise<NormalizedOrder[]> {
    const hash = await resolveAccountHash(accessToken, accountId);
    if (!hash) return [];
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const url = `${TRADER_URL}/accounts/${encodeURIComponent(hash)}/orders?fromEnteredTime=${encodeURIComponent(since)}&toEnteredTime=${encodeURIComponent(new Date().toISOString())}`;
    const orders = await schwabFetch(url, accessToken);
    if (!Array.isArray(orders)) return [];

    return orders.slice(0, 500).map((o: any) => {
      const leg = o?.orderLegCollection?.[0] || {};
      const instruction = String(leg.instruction || "").toUpperCase();
      const isSell = instruction.startsWith("SELL");
      const rawType = String(o.orderType || "").toLowerCase();
      let orderType: string = "market";
      if (rawType === "stop_limit") orderType = "stop_limit";
      else if (rawType === "stop") orderType = "stop";
      else if (rawType === "limit") orderType = "limit";
      else if (rawType === "market") orderType = "market";

      let legType: string | undefined;
      if (orderType === "stop" || orderType === "stop_limit") legType = "stop_loss";

      return {
        id: String(o.orderId ?? ""),
        symbol: leg?.instrument?.symbol || "UNKNOWN",
        side: isSell ? "sell" as const : "buy" as const,
        action: instruction.toLowerCase() || undefined,
        qty: Number(leg.quantity ?? o.quantity ?? 0),
        filledQty: Number(o.filledQuantity ?? 0),
        price: Number(o.price ?? 0) || null,
        stopPrice: Number(o.stopPrice ?? 0) || null,
        limitPrice: Number(o.price ?? 0) || null,
        status: String(o.status ?? "unknown").toLowerCase(),
        createdAt: o.enteredTime ?? "",
        orderType,
        legType,
        duration: o.duration ?? undefined,
      };
    });
  },

  async getOptionQuote(accessToken: string, optionSymbol: string): Promise<OptionQuote | null> {
    try {
      const data = await schwabFetch(
        `${MARKET_URL}/quotes?symbols=${encodeURIComponent(optionSymbol)}`,
        accessToken,
      );
      const entry = data?.[optionSymbol] ?? Object.values(data || {})[0];
      const q = (entry as any)?.quote ?? entry;
      if (!q) return null;
      const bid = Number(q.bidPrice ?? q.bid ?? 0);
      const ask = Number(q.askPrice ?? q.ask ?? 0);
      return {
        symbol: optionSymbol,
        bid,
        ask,
        mid: parseFloat(((bid + ask) / 2).toFixed(2)),
        last: Number(q.lastPrice ?? q.last ?? 0),
        volume: Number(q.totalVolume ?? q.volume ?? 0),
        openInterest: Number(q.openInterest ?? 0),
      };
    } catch (e) {
      console.error("[Schwab] getOptionQuote error:", (e as Error).message);
      return null;
    }
  },

  async placeOrder(accessToken: string, order: OrderRequest): Promise<OrderResponse> {
    const hash = await resolveAccountHash(accessToken, order.accountId);
    if (!hash) throw new Error("Schwab: could not resolve account hash for placeOrder");

    const isOption = order.orderClass === "option" && !!order.optionSymbol;
    const symbol = isOption ? order.optionSymbol! : order.symbol;

    const body: any = {
      orderType: mapOrderType(order.orderType),
      session: "NORMAL",
      duration: mapDuration(order.duration),
      orderStrategyType: "SINGLE",
      orderLegCollection: [{
        instruction: mapInstruction(order.side, isOption, order.optionSide),
        quantity: order.quantity,
        instrument: {
          symbol,
          assetType: isOption ? "OPTION" : "EQUITY",
        },
      }],
    };

    if (order.price !== undefined && (order.orderType === "limit" || order.orderType === "stop_limit")) {
      body.price = String(order.price);
    }
    if (order.stopPrice !== undefined && (order.orderType === "stop" || order.orderType === "stop_limit")) {
      body.stopPrice = String(order.stopPrice);
    }

    if (order.bracketTarget && order.bracketStop) {
      const exitInstruction = isOption
        ? (order.side === "buy" ? "SELL_TO_CLOSE" : "BUY_TO_CLOSE")
        : (order.side === "buy" ? "SELL" : "BUY");
      body.orderStrategyType = "TRIGGER";
      body.childOrderStrategies = [{
        orderStrategyType: "OCO",
        childOrderStrategies: [
          {
            orderType: "LIMIT",
            session: "NORMAL",
            duration: "GOOD_TILL_CANCEL",
            orderStrategyType: "SINGLE",
            price: String(order.bracketTarget),
            orderLegCollection: [{ instruction: exitInstruction, quantity: order.quantity, instrument: { symbol, assetType: isOption ? "OPTION" : "EQUITY" } }],
          },
          {
            orderType: "STOP",
            session: "NORMAL",
            duration: "GOOD_TILL_CANCEL",
            orderStrategyType: "SINGLE",
            stopPrice: String(order.bracketStop),
            orderLegCollection: [{ instruction: exitInstruction, quantity: order.quantity, instrument: { symbol, assetType: isOption ? "OPTION" : "EQUITY" } }],
          },
        ],
      }];
    }

    const response = await fetch(`${TRADER_URL}/accounts/${encodeURIComponent(hash)}/orders`, {
      method: "POST",
      headers: { ...schwabHeaders(accessToken), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok && response.status !== 201) {
      const text = await response.text().catch(() => "");
      throw new Error(`Schwab order error ${response.status}: ${text.substring(0, 300)}`);
    }

    // Schwab returns the new orderId in the Location header on a 201 Created.
    const location = response.headers.get("location") || response.headers.get("Location") || "";
    const orderIdMatch = location.match(/orders\/(\d+)/i);
    const orderId = orderIdMatch ? orderIdMatch[1] : "pending";

    return {
      orderId,
      symbol: isOption ? (order.optionSymbol || order.symbol) : order.symbol,
      side: order.side,
      quantity: order.quantity,
      status: "pending",
    };
  },

  async cancelOrder(accessToken: string, orderId: string, accountId?: string): Promise<{ success: boolean; message: string }> {
    const hash = await resolveAccountHash(accessToken, accountId);
    if (!hash) return { success: false, message: "Schwab: no account hash available for cancel" };

    const response = await fetch(`${TRADER_URL}/accounts/${encodeURIComponent(hash)}/orders/${encodeURIComponent(orderId)}`, {
      method: "DELETE",
      headers: schwabHeaders(accessToken),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { success: false, message: `Schwab cancel error ${response.status}: ${text.substring(0, 200)}` };
    }
    return { success: true, message: `Order ${orderId} cancelled` };
  },
};

// ---- Normalized quote for the broker-service quote layer ----
export interface SchwabNormalizedQuote {
  symbol: string;
  lastPrice: number;
  bidPrice: number;
  askPrice: number;
  markPrice: number;
  spread: number;
  spreadPercent: number;
  quoteTime: string | null;
  tradeTime: string | null;
  isDelayed: boolean;
  isStale: boolean;
  provider: "schwab";
}

export async function schwabGetNormalizedQuotes(accessToken: string, symbols: string[]): Promise<SchwabNormalizedQuote[]> {
  if (symbols.length === 0) return [];
  const data = await schwabFetch(
    `${MARKET_URL}/quotes?symbols=${encodeURIComponent(symbols.join(","))}`,
    accessToken,
  );
  const results: SchwabNormalizedQuote[] = [];
  const nowMs = Date.now();
  for (const sym of symbols) {
    const entry = data?.[sym];
    if (!entry) continue;
    const q = (entry as any).quote ?? entry;
    const bid = Number(q.bidPrice ?? q.bid ?? 0) || 0;
    const ask = Number(q.askPrice ?? q.ask ?? 0) || 0;
    const last = Number(q.lastPrice ?? q.last ?? 0) || 0;
    const mark = bid > 0 && ask > 0 ? parseFloat(((bid + ask) / 2).toFixed(4)) : last;
    const spread = ask > 0 && bid > 0 ? parseFloat((ask - bid).toFixed(4)) : 0;
    const spreadPercent = mark > 0 ? parseFloat(((spread / mark) * 100).toFixed(4)) : 0;
    const quoteTime = q.quoteTime ? new Date(Number(q.quoteTime)).toISOString() : null;
    const tradeTime = q.tradeTime ? new Date(Number(q.tradeTime)).toISOString() : null;
    const isDelayed = Boolean((entry as any).realtime === false || q.delayed === true);
    const tradeAgeMs = q.tradeTime ? nowMs - Number(q.tradeTime) : 0;
    const isStale = tradeAgeMs > 60 * 60 * 1000; // > 1h since last trade
    results.push({
      symbol: sym,
      lastPrice: last,
      bidPrice: bid,
      askPrice: ask,
      markPrice: mark,
      spread,
      spreadPercent,
      quoteTime,
      tradeTime,
      isDelayed,
      isStale,
      provider: "schwab",
    });
  }
  return results;
}
