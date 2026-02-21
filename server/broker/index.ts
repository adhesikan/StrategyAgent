import type { BrokerProvider, BrokerStatus, NormalizedAccount, NormalizedPosition, NormalizedOrder, OrderRequest, OrderResponse } from "./types";
import { tradierProvider, registerSandboxToken } from "./providers/tradier";
import { tradestationProvider } from "./providers/tradestation";
import { storage } from "../storage";

const providers: Record<string, BrokerProvider> = {
  tradier: tradierProvider,
  tradestation: tradestationProvider,
};

function getProvider(providerName: string): BrokerProvider {
  const provider = providers[providerName];
  if (!provider) {
    throw new Error(`Unsupported broker provider: ${providerName}`);
  }
  return provider;
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
      }

      if (newToken) {
        return { ...connection, accessToken: newToken };
      }
    }
  }

  return connection;
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
    const provider = getProvider(connection.provider);
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

  const provider = getProvider(connection.provider);
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

  const provider = getProvider(connection.provider);
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

  const provider = getProvider(connection.provider);

  try {
    const allOrders: NormalizedOrder[] = [];

    if (connection.preferredAccountId) {
      const { token, realAccountId } = resolveAccountToken(connection, connection.preferredAccountId);
      const orders = await provider.getOrders(token, realAccountId);
      allOrders.push(...orders);
      console.log(`[BrokerService] getBrokerOrders: ${connection.provider} preferred account ${connection.preferredAccountId} returned ${orders.length} orders`);
    } else {
      const accounts = await provider.getAccounts(connection.accessToken!);
      console.log(`[BrokerService] getBrokerOrders: ${connection.provider} has ${accounts.length} accounts, no preferred set — querying all`);
      for (const account of accounts) {
        try {
          const { token, realAccountId } = resolveAccountToken(connection, account.id);
          const orders = await provider.getOrders(token, realAccountId);
          console.log(`[BrokerService] getBrokerOrders: account ${account.id} (${account.name}) returned ${orders.length} orders`);
          allOrders.push(...orders);
        } catch (acctErr: any) {
          console.log(`[BrokerService] getBrokerOrders: error for account ${account.id}: ${acctErr.message}`);
        }
      }
    }

    if (connection.provider === "tradier" && connection.sandboxAccessToken) {
      try {
        registerSandboxToken(connection.sandboxAccessToken);
        const tp = provider as any;
        let sandboxAccountIds: string[] = [];
        if (tp.getSandboxAccounts) {
          const sandboxAccounts = await tp.getSandboxAccounts(connection.sandboxAccessToken);
          sandboxAccountIds = sandboxAccounts.map((a: any) => a.id);
        }
        if (sandboxAccountIds.length > 0) {
          for (const saId of sandboxAccountIds) {
            try {
              const sandboxOrders = await provider.getOrders(connection.sandboxAccessToken, saId);
              console.log(`[BrokerService] getBrokerOrders: tradier sandbox account ${saId} returned ${sandboxOrders.length} orders`);
              allOrders.push(...sandboxOrders);
            } catch (saErr: any) {
              console.log(`[BrokerService] getBrokerOrders: tradier sandbox account ${saId} error: ${saErr.message}`);
            }
          }
        } else {
          const sandboxOrders = await provider.getOrders(connection.sandboxAccessToken);
          console.log(`[BrokerService] getBrokerOrders: tradier sandbox returned ${sandboxOrders.length} orders`);
          allOrders.push(...sandboxOrders);
        }
      } catch (sandboxErr: any) {
        console.log(`[BrokerService] getBrokerOrders: tradier sandbox error: ${sandboxErr.message}`);
      }
    }

    const deduped = Array.from(new Map(allOrders.map(o => [o.id, o])).values());
    console.log(`[BrokerService] getBrokerOrders: ${connection.provider} total ${deduped.length} unique orders for user ${userId}`);
    setCache(cacheKey, deduped, CACHE_TTL.ORDERS);
    return deduped;
  } catch (error: any) {
    console.error(`[BrokerService] getBrokerOrders error (${connection.provider}):`, error.message);
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

  const provider = getProvider(connection.provider);
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
  const provider = getProvider(connection.provider);
  if (!provider.getOptionQuote) return null;
  const { token } = resolveAccountToken(connection, connection.preferredAccountId ?? undefined);
  return provider.getOptionQuote(token, optionSymbol);
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
