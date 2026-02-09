import type { BrokerProvider, BrokerStatus, NormalizedAccount, NormalizedPosition, NormalizedOrder, OrderRequest, OrderResponse } from "./types";
import { tradierProvider } from "./providers/tradier";
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
    return data.access_token;
  } catch (error) {
    console.error("[BrokerService] TradeStation token refresh error:", (error as Error).message);
    return null;
  }
}

async function getConnectionForUser(userId: string) {
  const connection = await storage.getBrokerConnectionWithToken(userId);
  if (!connection || !connection.accessToken || !connection.isConnected) {
    return null;
  }

  if (connection.provider === "tradestation" && connection.accessTokenExpiresAt) {
    const expiresAt = new Date(connection.accessTokenExpiresAt).getTime();
    const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000;
    if (expiresAt < fiveMinutesFromNow && connection.refreshToken) {
      const newToken = await refreshTradeStationToken(userId, connection.refreshToken);
      if (newToken) {
        return { ...connection, accessToken: newToken };
      }
    }
  }

  return connection;
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
  setCache(cacheKey, accounts, CACHE_TTL.ACCOUNTS);
  return accounts;
}

export async function getBrokerPositions(userId: string): Promise<NormalizedPosition[]> {
  const cacheKey = `positions:${userId}`;
  const cached = getCached<NormalizedPosition[]>(cacheKey);
  if (cached) return cached;

  const connection = await getConnectionForUser(userId);
  if (!connection || !isSupportedProvider(connection.provider)) return [];

  const provider = getProvider(connection.provider);
  const positions = await provider.getPositions(connection.accessToken!);
  setCache(cacheKey, positions, CACHE_TTL.POSITIONS);
  return positions;
}

export async function getBrokerOrders(userId: string): Promise<NormalizedOrder[]> {
  const cacheKey = `orders:${userId}`;
  const cached = getCached<NormalizedOrder[]>(cacheKey);
  if (cached) return cached;

  const connection = await getConnectionForUser(userId);
  if (!connection || !isSupportedProvider(connection.provider)) return [];

  const provider = getProvider(connection.provider);
  const orders = await provider.getOrders(connection.accessToken!);
  setCache(cacheKey, orders, CACHE_TTL.ORDERS);
  return orders;
}

export async function placeBrokerOrder(userId: string, order: OrderRequest): Promise<OrderResponse> {
  const connection = await getConnectionForUser(userId);
  if (!connection || !isSupportedProvider(connection.provider)) {
    throw new Error("No connected broker found or broker not supported for trading");
  }

  const provider = getProvider(connection.provider);
  const orderDesc = order.orderClass === "option"
    ? `${order.optionSide || "buy_to_open"} ${order.quantity} ${order.optionSymbol} (${order.symbol}) @ ${order.price ?? "market"}`
    : `${order.side} ${order.quantity} ${order.symbol} @ ${order.price ?? "market"}`;
  console.log(`[BrokerService] Placing order via ${connection.provider}: ${orderDesc}`);
  const result = await provider.placeOrder(connection.accessToken!, order);
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
  return provider.getOptionQuote(connection.accessToken!, optionSymbol);
}

export async function getConnectionProviderForUser(userId: string) {
  const connection = await getConnectionForUser(userId);
  if (!connection || !isSupportedProvider(connection.provider)) return null;
  return { provider: connection.provider, accessToken: connection.accessToken! };
}

export function invalidateBrokerCache(userId: string): void {
  for (const prefix of ["status", "accounts", "positions", "orders"]) {
    cache.delete(`${prefix}:${userId}`);
  }
}

export type { BrokerStatus, NormalizedAccount, NormalizedPosition, NormalizedOrder, OrderRequest, OrderResponse, OptionQuote } from "./types";
