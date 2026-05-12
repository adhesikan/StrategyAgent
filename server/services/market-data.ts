import { storage } from "../storage";
import {
  tradierGetBatchQuotes,
  tradierGetHistoricalBars,
  tradierGetIntradayBars,
  registerSandboxToken,
  type StockQuote,
  type HistoricalBar,
} from "../broker/providers/tradier";
import { tsGetBatchQuotes, tsGetHistoricalBars } from "../broker/providers/tradestation";
import { computeIndicators, type IndicatorBundle, type Bar } from "./indicators";

export interface MarketSnapshot {
  symbol: string;
  provider: "tradier" | "tradestation" | null;
  isPaper: boolean;
  quote: StockQuote | null;
  indicators: IndicatorBundle | null;
  barsCount: number;
}

interface ResolvedBrokerAuth {
  provider: "tradier" | "tradestation";
  token: string;
  isPaper: boolean;
}

async function resolveBrokerAuth(userId: string): Promise<ResolvedBrokerAuth | null> {
  const conn = await storage.getBrokerConnectionWithToken(userId);
  if (!conn || !conn.isConnected) return null;
  if (conn.provider !== "tradier" && conn.provider !== "tradestation") return null;

  const preferred = conn.preferredAccountId ?? null;
  const wantsSandbox = preferred?.startsWith("sandbox:") ?? false;

  if (conn.provider === "tradier" && wantsSandbox && conn.sandboxAccessToken) {
    registerSandboxToken(conn.sandboxAccessToken);
    return { provider: "tradier", token: conn.sandboxAccessToken, isPaper: true };
  }

  if (!conn.accessToken) return null;

  // TradeStation sim mode reuses the live token but a different base URL —
  // current snapshot calls use LIVE base only, so we annotate isPaper but still
  // hit the live endpoint. (Quote/history endpoints behave the same in both.)
  const isPaper = conn.provider === "tradestation" ? !!(conn as any).simMode && wantsSandbox : false;
  return { provider: conn.provider as "tradier" | "tradestation", token: conn.accessToken, isPaper };
}

export async function getMarketSnapshot(userId: string, symbol: string): Promise<MarketSnapshot> {
  const sym = symbol.toUpperCase();
  const empty: MarketSnapshot = { symbol: sym, provider: null, isPaper: false, quote: null, indicators: null, barsCount: 0 };

  const auth = await resolveBrokerAuth(userId);
  if (!auth) return empty;

  let quote: StockQuote | null = null;
  let bars: Bar[] = [];
  let intraday: Bar[] | undefined;

  try {
    if (auth.provider === "tradier") {
      const [quotes, daily, intra] = await Promise.all([
        tradierGetBatchQuotes(auth.token, [sym]),
        tradierGetHistoricalBars(auth.token, sym, { interval: "daily", lookbackDays: 365 }),
        tradierGetIntradayBars(auth.token, sym, 15).catch(() => [] as HistoricalBar[]),
      ]);
      quote = quotes.get(sym) ?? null;
      bars = daily as Bar[];
      intraday = intra as Bar[];
    } else {
      const [quotes, daily] = await Promise.all([
        tsGetBatchQuotes(auth.token, [sym]),
        tsGetHistoricalBars(auth.token, sym, { unit: "Daily", interval: 1, barsBack: 250 }),
      ]);
      quote = quotes.get(sym) ?? null;
      bars = daily as Bar[];
    }
  } catch (e) {
    console.warn(`[market-data] snapshot error for ${sym}:`, (e as Error).message);
  }

  const indicators = bars.length >= 20 ? computeIndicators(bars, intraday) : null;
  return { symbol: sym, provider: auth.provider, isPaper: auth.isPaper, quote, indicators, barsCount: bars.length };
}
