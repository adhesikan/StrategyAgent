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

async function getConnectionForUser(userId: string) {
  const connection = await storage.getBrokerConnectionWithToken(userId);
  if (!connection || !connection.accessToken || !connection.isConnected) {
    return null;
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
  return providerName in providers && providerName !== "tradestation";
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
  console.log(`[BrokerService] Placing ${order.side} order for ${order.quantity} ${order.symbol} via ${connection.provider}`);
  const result = await provider.placeOrder(connection.accessToken!, order);
  cache.delete(`orders:${userId}`);
  return result;
}

export function invalidateBrokerCache(userId: string): void {
  for (const prefix of ["status", "accounts", "positions", "orders"]) {
    cache.delete(`${prefix}:${userId}`);
  }
}

export type { BrokerStatus, NormalizedAccount, NormalizedPosition, NormalizedOrder, OrderRequest, OrderResponse } from "./types";
