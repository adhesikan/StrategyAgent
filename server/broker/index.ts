import type { BrokerProvider, BrokerStatus, NormalizedAccount, NormalizedPosition, NormalizedOrder, OrderRequest, OrderResponse } from "./types";
import {
  tradierProvider,
  registerSandboxToken,
  tradierGetOptionExpirations,
  tradierGetOptionChain,
  type OptionChainContract,
} from "./providers/tradier";
import {
  tradestationProvider,
  getTradeStationBaseUrl,
  tsGetOptionExpirations,
  tsGetOptionChain,
} from "./providers/tradestation";
import { schwabProvider } from "./providers/schwab";
import { storage } from "../storage";

const providers: Record<string, BrokerProvider> = {
  tradier: tradierProvider,
  tradestation: tradestationProvider,
  schwab: schwabProvider,
};

function getProvider(providerName: string): BrokerProvider {
  const provider = providers[providerName];
  if (!provider) {
    throw new Error(`Unsupported broker provider: ${providerName}`);
  }
  return provider;
}

function getProviderForConnection(connection: { provider: string; simMode?: boolean }): BrokerProvider {
  if (connection.provider === "tradestation" && connection.simMode) {
    const simBaseUrl = getTradeStationBaseUrl(true);

    return {
      async getStatus(accessToken: string) {
        const response = await fetch(`${simBaseUrl}/brokerage/accounts`, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        });
        if (!response.ok) throw new Error(`TradeStation SIM API error ${response.status}`);
        const accounts = await response.json();
        const accountList = accounts?.Accounts || accounts || [];
        const first = Array.isArray(accountList) ? accountList[0] : null;
        return { connected: true, provider: "tradestation" as const, accountId: first?.AccountID ?? undefined };
      },
      async getAccounts(accessToken: string) {
        const data = await fetch(`${simBaseUrl}/brokerage/accounts`, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        }).then(r => { if (!r.ok) throw new Error(`TradeStation SIM error ${r.status}`); return r.json(); });
        const accountList = data?.Accounts || data || [];
        if (!Array.isArray(accountList)) return [];
        const results: NormalizedAccount[] = [];
        for (const acct of accountList) {
          let balances: any = null;
          try {
            const balData = await fetch(`${simBaseUrl}/brokerage/accounts/${acct.AccountID}/balances`, {
              headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
            }).then(r => r.ok ? r.json() : null);
            balances = balData?.Balances?.[0] || balData;
          } catch {}
          results.push({
            id: acct.AccountID ?? "",
            name: `${acct.DisplayName || acct.Alias || acct.AccountID || "TradeStation"} (SIM)`,
            type: acct.AccountType || "unknown",
            buyingPower: parseFloat(balances?.BuyingPower ?? balances?.OptionBuyingPower ?? "0") || 0,
            equity: parseFloat(balances?.Equity ?? balances?.AccountBalance ?? "0") || 0,
            currency: balances?.Currency || "USD",
          });
        }
        return results;
      },
      async getPositions(accessToken: string, accountId?: string) {
        if (!accountId) { const s = await this.getStatus(accessToken); accountId = s.accountId; }
        if (!accountId) return [];
        const data = await fetch(`${simBaseUrl}/brokerage/accounts/${accountId}/positions`, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        }).then(r => { if (!r.ok) throw new Error(`TradeStation SIM error ${r.status}`); return r.json(); });
        const positions = data?.Positions || data || [];
        if (!Array.isArray(positions)) return [];
        return positions.map((p: any) => ({
          symbol: p.Symbol || "", qty: parseFloat(p.Quantity ?? "0"),
          avgPrice: parseFloat(p.AveragePrice ?? "0"), marketPrice: parseFloat(p.Last ?? p.MarketValue ?? "0"),
          unrealizedPnl: parseFloat(p.UnrealizedProfitLoss ?? "0"),
        }));
      },
      async getOrders(accessToken: string, accountId?: string) {
        if (!accountId) { const s = await this.getStatus(accessToken); accountId = s.accountId; }
        if (!accountId) return [];
        const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
        const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
        const allOrders: any[] = [];

        try {
          const activeData = await fetch(`${simBaseUrl}/brokerage/accounts/${accountId}/orders?since=${encodeURIComponent(since)}`, { headers }).then(r => { if (!r.ok) throw new Error(`SIM error ${r.status}`); return r.json(); });
          const active = activeData?.Orders || activeData || [];
          if (Array.isArray(active)) allOrders.push(...active);
        } catch {}

        try {
          const histData = await fetch(`${simBaseUrl}/brokerage/accounts/${accountId}/historicalorders?since=${encodeURIComponent(since)}`, { headers }).then(r => { if (!r.ok) throw new Error(`SIM error ${r.status}`); return r.json(); });
          const hist = histData?.Orders || histData || [];
          if (Array.isArray(hist)) allOrders.push(...hist);
        } catch {}

        for (const o of allOrders) {
          console.log(`[TradeStation SIM] Raw order #${o.OrderID}: Type=${o.OrderType} Status=${o.Status} GroupName=${o.GroupName || 'none'} ConditionalOrders=${(o.ConditionalOrders || []).length}`);
        }

        const flatOrders: any[] = [];
        for (const o of allOrders) {
          flatOrders.push(o);
          if (o.ConditionalOrders && Array.isArray(o.ConditionalOrders)) {
            for (const child of o.ConditionalOrders) {
              if (child.OrderID && !allOrders.some((existing: any) => String(existing.OrderID) === String(child.OrderID))) {
                child._parentOrderId = String(o.OrderID);
                child._isConditionalChild = true;
                if (!child.Legs && o.Legs) child.Legs = o.Legs;
                flatOrders.push(child);
              }
            }
          }
        }

        const deduped = Array.from(new Map(flatOrders.map((o: any) => [String(o.OrderID || ""), o])).values());
        console.log(`[TradeStation SIM] getOrders: ${deduped.length} orders (${allOrders.length} raw + flattened conditionals)`);
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
          const groupName = (o.GroupName || "").toLowerCase();
          const relationship = (o.Relationship || "").toLowerCase();
          const isChild = o._isConditionalChild === true;
          if (groupName.includes("oco") || groupName.includes("bracket") || isChild || relationship === "oco") {
            if (orderType === "stop" || orderType === "stop_limit") legType = "stop_loss";
            else if (orderType === "limit") legType = "profit_target";
            else legType = "exit";
          }
          if (orderType === "stop" && !legType) legType = "stop_loss";

          return {
            id: String(o.OrderID || ""), symbol: o.Legs?.[0]?.Symbol || o.Symbol || "UNKNOWN",
            side: isSell ? "sell" as const : "buy" as const,
            action: action || undefined,
            qty: parseInt(o.Legs?.[0]?.QuantityOrdered || o.Quantity || "0", 10),
            filledQty: parseInt(o.Legs?.[0]?.ExecQuantity || o.FilledQuantity || "0", 10),
            price: filledPrice || limitPrice || stopPrice,
            stopPrice, limitPrice,
            status: o.Status || o.StatusDescription || "unknown",
            createdAt: o.OpenedDateTime || o.ClosedDateTime || "",
            orderType,
            groupOrderId: o.GroupName || o._parentOrderId || undefined,
            groupOrderType: groupName || relationship || undefined,
            legType,
            duration: o.Duration || o.TimeInForce || undefined,
          };
        });
      },
      async getOptionQuote(accessToken: string, optionSymbol: string) {
        try {
          const data = await fetch(`${simBaseUrl}/marketdata/quotes/${encodeURIComponent(optionSymbol)}`, {
            headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
          }).then(r => { if (!r.ok) throw new Error(`TradeStation SIM error ${r.status}`); return r.json(); });
          const quotes = data?.Quotes || data || [];
          const quote = Array.isArray(quotes) ? quotes[0] : quotes;
          if (!quote) return null;
          const bid = parseFloat(quote.Bid ?? "0"), ask = parseFloat(quote.Ask ?? "0");
          return { symbol: optionSymbol, bid, ask, mid: parseFloat(((bid + ask) / 2).toFixed(2)),
            last: parseFloat(quote.Last ?? "0"), volume: parseInt(quote.Volume ?? "0", 10),
            openInterest: parseInt(quote.OpenInterest ?? "0", 10) };
        } catch { return null; }
      },
      async placeOrder(accessToken: string, order: OrderRequest) {
        const isOption = order.orderClass === "option" && order.optionSymbol;
        const body: any = {
          AccountID: order.accountId,
          Symbol: isOption ? order.optionSymbol : order.symbol,
          Quantity: String(order.quantity),
          OrderType: order.orderType === "market" ? "Market" : order.orderType === "stop" ? "StopMarket" : order.orderType === "stop_limit" ? "StopLimit" : "Limit",
          TradeAction: order.side === "buy" ? (isOption ? "BuyToOpen" : "Buy") : (isOption ? "SellToClose" : "Sell"),
          TimeInForce: { Duration: order.duration === "gtc" ? "GTC" : "DAY" },
        };
        if (order.price !== undefined && (order.orderType === "limit" || order.orderType === "stop_limit")) body.LimitPrice = String(order.price);
        if (order.stopPrice !== undefined && (order.orderType === "stop" || order.orderType === "stop_limit")) body.StopPrice = String(order.stopPrice);
        if (order.bracketTarget && order.bracketStop) {
          const exitSide = order.side === "buy" ? (isOption ? "SellToClose" : "Sell") : (isOption ? "BuyToClose" : "BuyToCover");
          body.OSOs = [{
            Type: "BRK",
            Orders: [
              { AccountID: order.accountId, Symbol: isOption ? order.optionSymbol : order.symbol, Quantity: String(order.quantity), OrderType: "Limit", TradeAction: exitSide, LimitPrice: String(order.bracketTarget), TimeInForce: { Duration: "GTC" } },
              { AccountID: order.accountId, Symbol: isOption ? order.optionSymbol : order.symbol, Quantity: String(order.quantity), OrderType: "StopMarket", TradeAction: exitSide, StopPrice: String(order.bracketStop), TimeInForce: { Duration: "GTC" } },
            ],
          }];
        }
        console.log(`[TradeStation SIM] Placing order:`, JSON.stringify(body).substring(0, 800));
        const response = await fetch(`${simBaseUrl}/orderexecution/orders`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) { const text = await response.text().catch(() => ""); throw new Error(`TradeStation SIM order error ${response.status}: ${text.substring(0, 300)}`); }
        const data = await response.json();
        if (data?.Errors?.length > 0) throw new Error(`TradeStation SIM order rejected: ${data.Errors.map((e: any) => e.Message || e).join("; ")}`);
        const orders = data?.Orders || [];
        const firstOrder = orders[0] || {};
        return {
          orderId: String(firstOrder.OrderID || data?.OrderID || "pending"),
          symbol: isOption ? (order.optionSymbol || order.symbol) : order.symbol,
          side: order.side, quantity: order.quantity, status: firstOrder.Status || "pending",
        };
      },
      async cancelOrder(accessToken: string, orderId: string) {
        const response = await fetch(`${simBaseUrl}/orderexecution/orders/${orderId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        });
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          return { success: false, message: `TradeStation SIM cancel error ${response.status}: ${text.substring(0, 200)}` };
        }
        return { success: true, message: `Order ${orderId} cancelled` };
      },
    };
  }
  return getProvider(connection.provider);
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<any>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

const CACHE_TTL = {
  STATUS: 10_000,
  ACCOUNTS: 15_000,
  POSITIONS: 5_000,
  ORDERS: 10_000,
};

async function refreshTradeStationToken(userId: string, refreshToken: string): Promise<string | null> {
  const clientId = process.env.TRADESTATION_CLIENT_ID;
  const clientSecret = process.env.TRADESTATION_CLIENT_SECRET;
  if (!clientId || !clientSecret || !refreshToken) return null;

  try {
    const response = await fetch("https://signin.tradestation.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      console.error(`[BrokerService] TradeStation token refresh failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (!data.access_token) return null;

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : undefined;

    await storage.setBrokerConnectionWithTokens(
      userId,
      "tradestation",
      data.access_token,
      data.refresh_token || refreshToken,
      expiresAt,
    );

    console.log(`[BrokerService] TradeStation token refreshed for user ${userId}`);
    invalidateBrokerCache(userId);
    return data.access_token;
  } catch (error) {
    console.error("[BrokerService] TradeStation token refresh error:", (error as Error).message);
    return null;
  }
}

async function refreshTradierToken(userId: string, refreshToken: string): Promise<string | null> {
  const clientId = process.env.TRADIER_CLIENT_ID;
  const clientSecret = process.env.TRADIER_CLIENT_SECRET;
  if (!clientId || !clientSecret || !refreshToken) return null;

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await fetch("https://api.tradier.com/v1/oauth/refreshtoken", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      console.error(`[BrokerService] Tradier token refresh failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (!data.access_token) return null;

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : new Date(Date.now() + 24 * 60 * 60 * 1000);

    await storage.setBrokerConnectionWithTokens(
      userId,
      "tradier",
      data.access_token,
      data.refresh_token || refreshToken,
      expiresAt,
    );

    console.log(`[BrokerService] Tradier token refreshed for user ${userId}`);
    invalidateBrokerCache(userId);
    return data.access_token;
  } catch (error) {
    console.error("[BrokerService] Tradier token refresh error:", (error as Error).message);
    return null;
  }
}

async function refreshSchwabToken(userId: string, refreshToken: string): Promise<string | null> {
  const clientId = process.env.SCHWAB_CLIENT_ID;
  const clientSecret = process.env.SCHWAB_CLIENT_SECRET;
  if (!clientId || !clientSecret || !refreshToken) return null;

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await fetch("https://api.schwabapi.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      console.error(`[BrokerService] Schwab token refresh failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (!data.access_token) return null;

    // Schwab access tokens are 30 min; refresh tokens are 7 days.
    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : new Date(Date.now() + 30 * 60 * 1000);

    await storage.setBrokerConnectionWithTokens(
      userId,
      "schwab",
      data.access_token,
      data.refresh_token || refreshToken,
      expiresAt,
    );

    console.log(`[BrokerService] Schwab token refreshed for user ${userId}`);
    invalidateBrokerCache(userId);
    return data.access_token;
  } catch (error) {
    console.error("[BrokerService] Schwab token refresh error:", (error as Error).message);
    return null;
  }
}

async function getConnectionForUser(userId: string) {
  const connection = await storage.getBrokerConnectionWithToken(userId);
  if (!connection || !connection.accessToken || !connection.isConnected) {
    return null;
  }

  if (connection.accessTokenExpiresAt) {
    const expiresAt = new Date(connection.accessTokenExpiresAt).getTime();
    const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000;

    if (expiresAt < fiveMinutesFromNow && connection.refreshToken) {
      let newToken: string | null = null;

      if (connection.provider === "tradestation") {
        newToken = await refreshTradeStationToken(userId, connection.refreshToken);
      } else if (connection.provider === "tradier") {
        newToken = await refreshTradierToken(userId, connection.refreshToken);
      } else if (connection.provider === "schwab") {
        newToken = await refreshSchwabToken(userId, connection.refreshToken);
      }

      if (newToken) {
        return { ...connection, accessToken: newToken };
      }
    }
  }

  return connection;
}

/**
 * Centralized helper for any code that needs a valid access token for a specific
 * provider. Performs a proactive refresh if the token is near expiry. Returns
 * null if the user has no connection for that provider or the token cannot be
 * refreshed (caller should treat this as requiresReauth).
 *
 * All Schwab/Tradier/TradeStation API calls outside this module should go
 * through this helper rather than reading tokens directly from storage.
 */
export async function getValidBrokerAccessToken(userId: string, provider: string): Promise<string | null> {
  const connection = await storage.getBrokerConnectionWithToken(userId);
  if (!connection || connection.provider !== provider || !connection.accessToken || !connection.isConnected) {
    return null;
  }

  const expiresAt = connection.accessTokenExpiresAt ? new Date(connection.accessTokenExpiresAt).getTime() : null;
  const needsRefresh = expiresAt !== null && expiresAt < Date.now() + 5 * 60 * 1000;

  if (needsRefresh) {
    if (!connection.refreshToken) {
      // Token is expired/near-expiry and we have no way to refresh — mark requiresReauth.
      try { await storage.updateBrokerConnectionStatus(userId, false); } catch {}
      return null;
    }
    let newToken: string | null = null;
    if (provider === "tradier") newToken = await refreshTradierToken(userId, connection.refreshToken);
    else if (provider === "tradestation") newToken = await refreshTradeStationToken(userId, connection.refreshToken);
    else if (provider === "schwab") newToken = await refreshSchwabToken(userId, connection.refreshToken);
    if (newToken) return newToken;
    // Refresh failed — mark the connection as needing re-auth so the UI surfaces it.
    try { await storage.updateBrokerConnectionStatus(userId, false); } catch {}
    return null;
  }

  return connection.accessToken;
}

/**
 * Force-refresh a user's broker token (e.g. after a 401/403 response from the
 * broker API). Returns the new access token on success or null on failure
 * (in which case the connection is marked requiresReauth).
 */
export async function forceRefreshBrokerToken(userId: string, provider: string): Promise<string | null> {
  const connection = await storage.getBrokerConnectionWithToken(userId);
  if (!connection || connection.provider !== provider || !connection.refreshToken) {
    try { await storage.updateBrokerConnectionStatus(userId, false); } catch {}
    return null;
  }
  let newToken: string | null = null;
  if (provider === "tradier") newToken = await refreshTradierToken(userId, connection.refreshToken);
  else if (provider === "tradestation") newToken = await refreshTradeStationToken(userId, connection.refreshToken);
  else if (provider === "schwab") newToken = await refreshSchwabToken(userId, connection.refreshToken);
  if (!newToken) {
    try { await storage.updateBrokerConnectionStatus(userId, false); } catch {}
  }
  return newToken;
}

export async function getTokenHealth(userId: string): Promise<{ status: "valid" | "expiring" | "expired" | "unknown"; expiresAt: string | null; provider: string | null }> {
  const connection = await storage.getBrokerConnectionWithToken(userId);
  if (!connection || !connection.isConnected) {
    return { status: "unknown", expiresAt: null, provider: null };
  }

  if (!connection.accessTokenExpiresAt) {
    return { status: "unknown", expiresAt: null, provider: connection.provider };
  }

  const expiresAt = new Date(connection.accessTokenExpiresAt).getTime();
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;

  let status: "valid" | "expiring" | "expired" | "unknown";
  if (expiresAt <= now) {
    status = "expired";
  } else if (expiresAt <= now + oneHour) {
    status = "expiring";
  } else {
    status = "valid";
  }

  return {
    status,
    expiresAt: new Date(expiresAt).toISOString(),
    provider: connection.provider,
  };
}

export async function getBrokerStatus(userId: string): Promise<BrokerStatus> {
  const cacheKey = `status:${userId}`;
  const cached = getCached<BrokerStatus>(cacheKey);
  if (cached) return cached;

  const connection = await getConnectionForUser(userId);
  if (!connection) {
    return { connected: false, provider: null };
  }

  try {
    const provider = getProviderForConnection(connection);
    const status = await provider.getStatus(connection.accessToken!);
    setCache(cacheKey, status, CACHE_TTL.STATUS);
    return status;
  } catch (error) {
    console.error(`[BrokerService] Status check failed for ${connection.provider}:`, (error as Error).message);
    return { connected: false, provider: connection.provider as any };
  }
}

function isSupportedProvider(providerName: string): boolean {
  return providerName in providers;
}

export async function getBrokerAccounts(userId: string): Promise<NormalizedAccount[]> {
  const cacheKey = `accounts:${userId}`;
  const cached = getCached<NormalizedAccount[]>(cacheKey);
  if (cached) return cached;

  const connection = await getConnectionForUser(userId);
  if (!connection || !isSupportedProvider(connection.provider)) return [];

  const provider = getProviderForConnection(connection);
  const accounts = await provider.getAccounts(connection.accessToken!);

  if (connection.provider === "tradier" && connection.sandboxAccessToken) {
    registerSandboxToken(connection.sandboxAccessToken);
    try {
      const tp = provider as any;
      if (tp.getSandboxAccounts) {
        const sandboxAccounts = await tp.getSandboxAccounts(connection.sandboxAccessToken);
        for (const sa of sandboxAccounts) {
          sa.id = `sandbox:${sa.id}`;
          sa.name = sa.name ? `${sa.name} (Paper)` : `Paper ${sa.id.replace('sandbox:', '')}`;
        }
        accounts.push(...sandboxAccounts);
      }
    } catch (error) {
      console.error("[BrokerService] Failed to fetch sandbox accounts:", (error as Error).message);
    }
  }

  setCache(cacheKey, accounts, CACHE_TTL.ACCOUNTS);
  return accounts;
}

function resolveAccountToken(connection: any, accountId?: string): { token: string; realAccountId?: string; isSandbox: boolean } {
  if (accountId?.startsWith("sandbox:") && connection.sandboxAccessToken) {
    registerSandboxToken(connection.sandboxAccessToken);
    return { token: connection.sandboxAccessToken, realAccountId: accountId.replace("sandbox:", ""), isSandbox: true };
  }
  return { token: connection.accessToken!, realAccountId: accountId, isSandbox: false };
}

export async function getBrokerPositions(userId: string): Promise<NormalizedPosition[]> {
  const cacheKey = `positions:${userId}`;
  const cached = getCached<NormalizedPosition[]>(cacheKey);
  if (cached) return cached;

  const connection = await getConnectionForUser(userId);
  if (!connection || !isSupportedProvider(connection.provider)) return [];

  const provider = getProviderForConnection(connection);
  const { token, realAccountId } = resolveAccountToken(connection, connection.preferredAccountId ?? undefined);
  const positions = await provider.getPositions(token, realAccountId);
  setCache(cacheKey, positions, CACHE_TTL.POSITIONS);
  return positions;
}

export async function getBrokerOrders(userId: string): Promise<NormalizedOrder[]> {
  const cacheKey = `orders:${userId}`;
  const cached = getCached<NormalizedOrder[]>(cacheKey);
  if (cached) return cached;

  const connection = await getConnectionForUser(userId);
  if (!connection || !isSupportedProvider(connection.provider)) {
    console.log(`[BrokerService] getBrokerOrders: no connection or unsupported provider for user ${userId}`);
    return [];
  }

  const provider = getProviderForConnection(connection);
  const { token, realAccountId } = resolveAccountToken(connection, connection.preferredAccountId ?? undefined);

  try {
    const primaryOrders = await provider.getOrders(token, realAccountId);
    console.log(`[BrokerService] getBrokerOrders: ${connection.provider} account ${realAccountId ?? 'default'} returned ${primaryOrders.length} orders`);

    const allOrders: NormalizedOrder[] = [...primaryOrders];

    if (connection.provider === "tradier" && connection.sandboxAccessToken) {
      try {
        registerSandboxToken(connection.sandboxAccessToken);
        const sandboxOrders = await provider.getOrders(connection.sandboxAccessToken);
        console.log(`[BrokerService] getBrokerOrders: tradier sandbox returned ${sandboxOrders.length} orders`);
        allOrders.push(...sandboxOrders);
      } catch (sandboxErr: any) {
        console.log(`[BrokerService] getBrokerOrders: tradier sandbox error (non-fatal): ${sandboxErr.message}`);
      }
    }

    const deduped = allOrders.length > primaryOrders.length
      ? Array.from(new Map(allOrders.map(o => [o.id, o])).values())
      : allOrders;

    console.log(`[BrokerService] getBrokerOrders: ${connection.provider} total ${deduped.length} unique orders for user ${userId}`);
    setCache(cacheKey, deduped, CACHE_TTL.ORDERS);
    return deduped;
  } catch (error: any) {
    console.error(`[BrokerService] getBrokerOrders error (${connection.provider}, account ${realAccountId ?? 'default'}): ${error.message}`);
    return [];
  }
}

export async function placeBrokerOrder(userId: string, order: OrderRequest): Promise<OrderResponse> {
  const connection = await getConnectionForUser(userId);
  if (!connection || !isSupportedProvider(connection.provider)) {
    throw new Error("No connected broker found or broker not supported for trading");
  }

  const { token, isSandbox } = resolveAccountToken(connection, order.accountId);
  if (isSandbox) {
    order = { ...order, accountId: order.accountId.replace("sandbox:", "") };
  }

  const provider = getProviderForConnection(connection);
  const orderDesc = order.orderClass === "option"
    ? `${order.optionSide || "buy_to_open"} ${order.quantity} ${order.optionSymbol} (${order.symbol}) @ ${order.price ?? "market"}`
    : `${order.side} ${order.quantity} ${order.symbol} @ ${order.price ?? "market"}`;
  console.log(`[BrokerService] Placing ${isSandbox ? "PAPER " : ""}order via ${connection.provider}: ${orderDesc}`);
  const result = await provider.placeOrder(token, order);
  cache.delete(`orders:${userId}`);
  return result;
}

export async function getOptionQuote(userId: string, optionSymbol: string) {
  const connection = await getConnectionForUser(userId);
  if (!connection || !isSupportedProvider(connection.provider)) {
    return null;
  }
  const provider = getProviderForConnection(connection);
  if (!provider.getOptionQuote) return null;
  const { token } = resolveAccountToken(connection, connection.preferredAccountId ?? undefined);
  return provider.getOptionQuote(token, optionSymbol);
}

export async function getOptionExpirations(userId: string, symbol: string): Promise<string[]> {
  const connection = await getConnectionForUser(userId);
  if (!connection || !isSupportedProvider(connection.provider)) return [];
  const { token } = resolveAccountToken(connection, connection.preferredAccountId ?? undefined);
  if (connection.provider === "tradestation") return tsGetOptionExpirations(token, symbol);
  return tradierGetOptionExpirations(token, symbol);
}

export async function getOptionChain(
  userId: string,
  symbol: string,
  expiration: string,
): Promise<OptionChainContract[]> {
  const connection = await getConnectionForUser(userId);
  if (!connection || !isSupportedProvider(connection.provider)) return [];
  const { token } = resolveAccountToken(connection, connection.preferredAccountId ?? undefined);
  if (connection.provider === "tradestation") return tsGetOptionChain(token, symbol, expiration);
  return tradierGetOptionChain(token, symbol, expiration);
}

export async function cancelBrokerOrder(userId: string, orderId: string): Promise<{ success: boolean; message: string }> {
  const connection = await getConnectionForUser(userId);
  if (!connection || !isSupportedProvider(connection.provider)) {
    return { success: false, message: "No connected broker found" };
  }

  const provider = getProviderForConnection(connection);
  const { token, realAccountId } = resolveAccountToken(connection, connection.preferredAccountId ?? undefined);

  console.log(`[BrokerService] cancelBrokerOrder: ${connection.provider} order ${orderId} for user ${userId.substring(0, 8)}...`);
  const result = await provider.cancelOrder(token, orderId, realAccountId);

  if (result.success) {
    invalidateBrokerCache(userId);
  }

  return result;
}

export async function getConnectionProviderForUser(userId: string) {
  const connection = await getConnectionForUser(userId);
  if (!connection || !isSupportedProvider(connection.provider)) return null;
  const { token } = resolveAccountToken(connection, connection.preferredAccountId ?? undefined);
  return { provider: connection.provider, accessToken: token };
}

export function invalidateBrokerCache(userId: string): void {
  for (const prefix of ["status", "accounts", "positions", "orders"]) {
    cache.delete(`${prefix}:${userId}`);
  }
}

export type { BrokerStatus, NormalizedAccount, NormalizedPosition, NormalizedOrder, OrderRequest, OrderResponse, OptionQuote } from "./types";
