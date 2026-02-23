import { BrokerConnection, ScanResult, PatternStage, StrategyType } from "@shared/schema";
import { randomUUID } from "crypto";
import { classifyQuote, StrategyId, PullbackStage } from "./strategies";
import { getTradeStationBaseUrl } from "./broker/providers/tradestation";

// Extended type for broker connection with decrypted credentials
export interface DecryptedBrokerConnection extends BrokerConnection {
  accessToken?: string;
  refreshToken?: string | null;
  simMode?: boolean;
}

// Cache for extended hours prices with 60-second TTL
interface CachedExtendedPrice {
  price: number;
  volume: number;
  timestamp: number;
}

const extendedPriceCache = new Map<string, CachedExtendedPrice>();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

function getCachedExtendedPrice(symbol: string): { price: number; volume: number } | null {
  const cached = extendedPriceCache.get(symbol);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { price: cached.price, volume: cached.volume };
  }
  return null;
}

function setCachedExtendedPrice(symbol: string, price: number, volume: number): void {
  extendedPriceCache.set(symbol, { price, volume, timestamp: Date.now() });
}

// Rate-limited batch fetcher for extended hours prices
async function fetchExtendedPricesBatch(
  accessToken: string,
  symbols: string[],
  concurrencyLimit: number = 5
): Promise<Map<string, { price: number; volume: number }>> {
  const results = new Map<string, { price: number; volume: number }>();
  
  // Check cache first, filter out already cached symbols
  const symbolsToFetch: string[] = [];
  for (const symbol of symbols) {
    const cached = getCachedExtendedPrice(symbol);
    if (cached) {
      results.set(symbol, cached);
    } else {
      symbolsToFetch.push(symbol);
    }
  }
  
  if (symbolsToFetch.length === 0) {
    return results;
  }
  
  // Fetch uncached symbols in batches with controlled concurrency
  for (let i = 0; i < symbolsToFetch.length; i += concurrencyLimit) {
    const batch = symbolsToFetch.slice(i, i + concurrencyLimit);
    const batchPromises = batch.map(async (symbol) => {
      const result = await fetchTradierLatestPrice(accessToken, symbol);
      if (result && result.price > 0) {
        setCachedExtendedPrice(symbol, result.price, result.volume);
        return { symbol, result };
      }
      return { symbol, result: null };
    });
    
    const batchResults = await Promise.all(batchPromises);
    for (const { symbol, result } of batchResults) {
      if (result) {
        results.set(symbol, result);
      }
    }
  }
  
  return results;
}

export interface QuoteData {
  symbol: string;
  last: number;
  change: number;
  changePercent: number;
  volume: number;
  avgVolume?: number;
  high: number;
  low: number;
  open: number;
  prevClose: number;
}

// Helper to get the latest extended hours price from timesales
async function fetchTradierLatestPrice(
  accessToken: string,
  symbol: string
): Promise<{ price: number; volume: number } | null> {
  try {
    // Get the last hour of timesales with extended hours (wider window for pre-market data)
    // Use Eastern Time for Tradier API
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    // Format in Eastern Time: YYYY-MM-DD HH:MM
    const formatDateTimeET = (d: Date) => {
      const etDate = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const year = etDate.getFullYear();
      const month = String(etDate.getMonth() + 1).padStart(2, '0');
      const day = String(etDate.getDate()).padStart(2, '0');
      const hour = String(etDate.getHours()).padStart(2, '0');
      const min = String(etDate.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day}%20${hour}:${min}`;
    };
    
    const start = formatDateTimeET(oneHourAgo);
    const end = formatDateTimeET(now);
    
    const url = `https://api.tradier.com/v1/markets/timesales?symbol=${symbol}&interval=1min&start=${start}&end=${end}&session_filter=all`;
    
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    
    if (!response.ok) {
      console.log(`[Tradier] timesales error for ${symbol}: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    const series = data.series?.data;
    if (!series) {
      return null;
    }
    
    const seriesArray = Array.isArray(series) ? series : [series];
    if (seriesArray.length === 0) return null;
    
    // Get the most recent data point
    const latest = seriesArray[seriesArray.length - 1];
    const price = latest.close || latest.price || 0;
    if (price > 0) {
      console.log(`[Tradier] Extended price for ${symbol}: $${price}`);
    }
    return {
      price,
      volume: latest.volume || 0,
    };
  } catch (e) {
    console.error(`[Tradier] timesales exception for ${symbol}:`, e);
    return null;
  }
}

export async function fetchTradierQuotes(
  accessToken: string,
  symbols: string[]
): Promise<QuoteData[]> {
  const symbolList = symbols.join(",");
  const response = await fetch(
    `https://api.tradier.com/v1/markets/quotes?symbols=${symbolList}&greeks=false`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Tradier API error: ${response.status}`);
  }

  const data = await response.json();
  const quotes = data.quotes?.quote;
  
  if (!quotes) return [];
  
  const quoteArray = Array.isArray(quotes) ? quotes : [quotes];
  
  // Check if market is in extended hours (before 9:30 AM or after 4 PM ET)
  const now = new Date();
  const etHour = parseInt(now.toLocaleString('en-US', { hour: '2-digit', hour12: false, timeZone: 'America/New_York' }));
  const etMinute = parseInt(now.toLocaleString('en-US', { minute: '2-digit', timeZone: 'America/New_York' }));
  const dayOfWeek = now.toLocaleString('en-US', { weekday: 'short', timeZone: 'America/New_York' });
  const marketMinutes = etHour * 60 + etMinute;
  const isExtendedHours = marketMinutes < 570 || marketMinutes >= 960; // Before 9:30 AM or after 4:00 PM ET
  
  console.log(`[Tradier] Time check: ${dayOfWeek} ${etHour}:${etMinute} ET, marketMinutes=${marketMinutes}, isExtendedHours=${isExtendedHours}`);
  
  // If in extended hours, fetch prices using cached, rate-limited batch fetcher
  // Wrapped in try/catch with timeout so the scan still works even if extended prices fail
  let extendedPrices: Map<string, { price: number; volume: number }> = new Map();
  
  if (isExtendedHours) {
    const allSymbols = quoteArray.map((q: any) => q.symbol);
    // Limit extended price fetches to avoid timeouts on large universes
    const MAX_EXTENDED_SYMBOLS = 100;
    const symbolsToFetch = allSymbols.length > MAX_EXTENDED_SYMBOLS 
      ? allSymbols.slice(0, MAX_EXTENDED_SYMBOLS) 
      : allSymbols;
    console.log(`[Tradier] Fetching extended hours for ${symbolsToFetch.length}/${allSymbols.length} symbols...`);
    
    try {
      // Race against a 15-second timeout so the scan always returns
      const fetchPromise = fetchExtendedPricesBatch(accessToken, symbolsToFetch);
      const timeoutPromise = new Promise<Map<string, { price: number; volume: number }>>((resolve) => {
        setTimeout(() => {
          console.log(`[Tradier] Extended hours fetch timed out after 15s, using regular quote data`);
          resolve(new Map());
        }, 15000);
      });
      extendedPrices = await Promise.race([fetchPromise, timeoutPromise]);
      console.log(`[Tradier] Extended hours result: ${extendedPrices.size}/${symbolsToFetch.length} symbols with prices`);
    } catch (extError: any) {
      console.error(`[Tradier] Extended hours fetch failed, using regular quote data:`, extError.message);
      // Continue with empty extended prices — regular quote data will be used
    }
  }
  
  return quoteArray.map((q: any) => {
    const prevClose = q.prevclose || q.close || 0;
    // During premarket, q.last might be 0/null — fall back to close, then prevclose
    let lastPrice = q.last || q.close || q.prevclose || 0;
    
    // Use extended hours price if available
    const extPrice = extendedPrices.get(q.symbol);
    if (extPrice && extPrice.price > 0) {
      lastPrice = extPrice.price;
    }
    
    // Final safety: if lastPrice is still 0, skip this quote
    if (lastPrice <= 0) {
      lastPrice = prevClose > 0 ? prevClose : 0;
    }
    
    // Calculate change from previous close
    const change = prevClose > 0 ? (lastPrice - prevClose) : (q.change || 0);
    const changePercent = prevClose > 0 ? ((lastPrice - prevClose) / prevClose) * 100 : (q.change_percentage || 0);
    
    // During premarket, high/low/open may be 0 — use lastPrice as fallback
    const high = (q.high && q.high > 0) ? q.high : lastPrice;
    const low = (q.low && q.low > 0) ? q.low : lastPrice;
    const openPrice = (q.open && q.open > 0) ? q.open : lastPrice;
    
    return {
      symbol: q.symbol,
      last: lastPrice,
      change: change,
      changePercent: changePercent,
      volume: q.volume || 0,
      avgVolume: q.average_volume || 0,
      high: high,
      low: low,
      open: openPrice,
      prevClose: prevClose,
    };
  });
}

export async function fetchPolygonQuotes(
  accessToken: string,
  symbols: string[]
): Promise<QuoteData[]> {
  const results: QuoteData[] = [];
  
  for (const symbol of symbols) {
    try {
      const response = await fetch(
        `https://api.polygon.io/v2/aggs/ticker/${symbol}/prev?apiKey=${accessToken}`
      );
      
      if (response.ok) {
        const data = await response.json();
        const result = data.results?.[0];
        if (result) {
          results.push({
            symbol,
            last: result.c,
            change: result.c - result.o,
            changePercent: ((result.c - result.o) / result.o) * 100,
            volume: result.v,
            high: result.h,
            low: result.l,
            open: result.o,
            prevClose: result.o,
          });
        }
      }
    } catch (e) {
      console.error(`Failed to fetch ${symbol} from Polygon:`, e);
    }
  }
  
  return results;
}

export async function fetchAlpacaQuotes(
  accessToken: string,
  secretKey: string | null,
  symbols: string[]
): Promise<QuoteData[]> {
  const symbolList = symbols.join(",");
  
  const headers: Record<string, string> = {
    "APCA-API-KEY-ID": accessToken,
  };
  
  if (secretKey) {
    headers["APCA-API-SECRET-KEY"] = secretKey;
  }

  // Use SIP feed for extended hours data (pre-market and after-hours)
  const response = await fetch(
    `https://data.alpaca.markets/v2/stocks/bars/latest?symbols=${symbolList}&feed=sip`,
    { headers }
  );

  if (!response.ok) {
    throw new Error(`Alpaca API error: ${response.status}`);
  }

  const data = await response.json();
  const bars = data.bars || {};

  return Object.entries(bars).map(([symbol, bar]: [string, any]) => ({
    symbol,
    last: bar.c || 0,
    change: bar.c - bar.o,
    changePercent: bar.o ? ((bar.c - bar.o) / bar.o) * 100 : 0,
    volume: bar.v || 0,
    high: bar.h || 0,
    low: bar.l || 0,
    open: bar.o || 0,
    prevClose: bar.o || 0,
  }));
}

export async function fetchIBKRQuotes(
  accessToken: string,
  symbols: string[]
): Promise<QuoteData[]> {
  console.log("IBKR integration requires Client Portal API setup");
  throw new Error("Interactive Brokers integration requires additional setup. Please use Tradier, Alpaca, or Polygon for now.");
}

export async function fetchSchwabQuotes(
  accessToken: string,
  symbols: string[]
): Promise<QuoteData[]> {
  const symbolList = symbols.join(",");
  
  const response = await fetch(
    `https://api.schwabapi.com/marketdata/v1/quotes?symbols=${symbolList}`,
    {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Schwab API error: ${response.status}`);
  }

  const data = await response.json();
  
  return Object.entries(data).map(([symbol, quote]: [string, any]) => {
    const q = quote.quote || quote;
    return {
      symbol,
      last: q.lastPrice || q.mark || 0,
      change: q.netChange || 0,
      changePercent: q.netPercentChangeInDouble || 0,
      volume: q.totalVolume || 0,
      avgVolume: q.averageVolume || 0,
      high: q.highPrice || q["52WkHigh"] || 0,
      low: q.lowPrice || q["52WkLow"] || 0,
      open: q.openPrice || 0,
      prevClose: q.closePrice || 0,
    };
  });
}

async function fetchTastyTradeQuotes(accessToken: string, symbols: string[]): Promise<QuoteData[]> {
  const headers = {
    "Authorization": `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  const quotes: QuoteData[] = [];
  for (const symbol of symbols) {
    try {
      const response = await fetch(
        `https://api.tastytrade.com/market-data/quotes/${symbol}`,
        { headers }
      );
      if (response.ok) {
        const data = await response.json();
        const quote = data.data;
        if (quote) {
          quotes.push({
            symbol,
            last: quote.last || 0,
            change: quote.netChange || 0,
            changePercent: quote.netChangePercent || 0,
            volume: quote.volume || 0,
            avgVolume: quote.avgVolume || 0,
            high: quote.high || 0,
            low: quote.low || 0,
            open: quote.open || 0,
            prevClose: quote.previousClose || 0,
          });
        }
      }
    } catch (error) {
      console.error(`TastyTrade quote error for ${symbol}:`, error);
    }
  }
  return quotes;
}

async function fetchTradeStationQuotes(accessToken: string, symbols: string[], simMode?: boolean): Promise<QuoteData[]> {
  const headers = {
    "Authorization": `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  const tsBase = getTradeStationBaseUrl(simMode);
  const symbolList = symbols.join(",");
  const response = await fetch(
    `${tsBase}/marketdata/quotes/${symbolList}`,
    { headers }
  );

  if (!response.ok) {
    throw new Error(`TradeStation API error: ${response.status}`);
  }

  const data = await response.json();
  const quotesData = data.Quotes || [];

  return quotesData.map((q: any) => ({
    symbol: q.Symbol,
    last: parseFloat(q.Last) || 0,
    change: parseFloat(q.NetChange) || 0,
    changePercent: parseFloat(q.NetChangePct) || 0,
    volume: parseInt(q.Volume, 10) || 0,
    avgVolume: parseInt(q.AvgVolume, 10) || 0,
    high: parseFloat(q.High) || 0,
    low: parseFloat(q.Low) || 0,
    open: parseFloat(q.Open) || 0,
    prevClose: parseFloat(q.PreviousClose) || 0,
  }));
}

export async function fetchQuotesFromBroker(
  connection: DecryptedBrokerConnection,
  symbols: string[]
): Promise<QuoteData[]> {
  if (!connection.accessToken) {
    throw new Error("No access token available");
  }

  switch (connection.provider) {
    case "tradier":
      return fetchTradierQuotes(connection.accessToken, symbols);
    case "polygon":
      return fetchPolygonQuotes(connection.accessToken, symbols);
    case "alpaca":
      return fetchAlpacaQuotes(connection.accessToken, connection.refreshToken ?? null, symbols);
    case "ibkr":
      return fetchIBKRQuotes(connection.accessToken, symbols);
    case "schwab":
      return fetchSchwabQuotes(connection.accessToken, symbols);
    case "tastytrade":
      return fetchTastyTradeQuotes(connection.accessToken, symbols);
    case "tradestation":
      return fetchTradeStationQuotes(connection.accessToken, symbols, connection.simMode);
    default:
      throw new Error(`Provider ${connection.provider} not supported for market data`);
  }
}

function calculateVCPStage(quote: QuoteData): "FORMING" | "READY" | "BREAKOUT" {
  const priceFromHigh = ((quote.high - quote.last) / quote.high) * 100;
  
  if (quote.change > 0 && quote.changePercent > 2) {
    return PatternStage.BREAKOUT;
  } else if (priceFromHigh < 5 && quote.change > 0) {
    return PatternStage.READY;
  }
  return PatternStage.FORMING;
}

function calculateVCPMultidayStage(quote: QuoteData): string {
  const priceFromHigh = ((quote.high - quote.last) / quote.high) * 100;
  const rvol = quote.avgVolume ? quote.volume / quote.avgVolume : 1;
  
  if (quote.changePercent > 3 && rvol >= 1.8 && priceFromHigh < 3) {
    return PatternStage.BREAKOUT;
  } else if (priceFromHigh < 8 && priceFromHigh > 2 && rvol < 1.2) {
    return PatternStage.READY;
  }
  return PatternStage.FORMING;
}

function calculateClassicPullbackStage(quote: QuoteData): string {
  const rvol = quote.avgVolume ? quote.volume / quote.avgVolume : 1;
  
  if (quote.changePercent > 1.5 && rvol >= 1.5) {
    return PullbackStage.BREAKOUT;
  } else if (quote.changePercent >= -2.5 && quote.changePercent <= 0.5 && quote.change >= 0) {
    return PullbackStage.READY;
  }
  return PullbackStage.FORMING;
}

function calculateVWAPReclaimStage(quote: QuoteData): string {
  const rvol = quote.avgVolume ? quote.volume / quote.avgVolume : 1;
  
  if (quote.changePercent > 0.5 && quote.changePercent < 3 && rvol >= 1.3) {
    return PullbackStage.BREAKOUT;
  } else if (quote.changePercent >= -1 && quote.changePercent <= 0.5) {
    return PullbackStage.READY;
  }
  return PullbackStage.FORMING;
}

function calculateORBStage(quote: QuoteData, minutes: number): string {
  const rvol = quote.avgVolume ? quote.volume / quote.avgVolume : 1;
  const threshold = minutes === 5 ? 1.5 : 2.0;
  
  if (quote.changePercent > threshold && rvol >= 1.5) {
    return PullbackStage.BREAKOUT;
  } else if (quote.changePercent > 0 && quote.changePercent <= threshold) {
    return PullbackStage.READY;
  }
  return PullbackStage.FORMING;
}

function calculateHighRVOLStage(quote: QuoteData): string {
  const rvol = quote.avgVolume ? quote.volume / quote.avgVolume : 1;
  
  if (rvol >= 3.0 && quote.changePercent > 2) {
    return PullbackStage.BREAKOUT;
  } else if (rvol >= 2.0 && quote.changePercent > 0) {
    return PullbackStage.READY;
  }
  return PullbackStage.FORMING;
}

function calculateGapAndGoStage(quote: QuoteData): string {
  const rvol = quote.avgVolume ? quote.volume / quote.avgVolume : 1;
  
  if (quote.changePercent > 5 && rvol >= 2.0) {
    return PullbackStage.BREAKOUT;
  } else if (quote.changePercent > 3 && rvol >= 1.5) {
    return PullbackStage.READY;
  }
  return PullbackStage.FORMING;
}

function calculateTrendContinuationStage(quote: QuoteData): string {
  const rvol = quote.avgVolume ? quote.volume / quote.avgVolume : 1;
  
  if (quote.changePercent > 1.5 && rvol >= 1.2 && quote.change > 0) {
    return PullbackStage.BREAKOUT;
  } else if (quote.changePercent >= 0 && quote.changePercent <= 1.5) {
    return PullbackStage.READY;
  }
  return PullbackStage.FORMING;
}

function calculateVolatilitySqueezeStage(quote: QuoteData): string {
  const rvol = quote.avgVolume ? quote.volume / quote.avgVolume : 1;
  const priceFromHigh = ((quote.high - quote.last) / quote.high) * 100;
  
  if (quote.changePercent > 2.5 && rvol >= 2.0) {
    return PullbackStage.BREAKOUT;
  } else if (priceFromHigh < 3 && Math.abs(quote.changePercent) < 1) {
    return PullbackStage.READY;
  }
  return PullbackStage.FORMING;
}

function calculateStageForStrategy(quote: QuoteData, strategy: string): string {
  switch (strategy) {
    case StrategyType.VCP:
      return calculateVCPStage(quote);
    case StrategyType.VCP_MULTIDAY:
      return calculateVCPMultidayStage(quote);
    case StrategyType.CLASSIC_PULLBACK:
      return calculateClassicPullbackStage(quote);
    case StrategyType.VWAP_RECLAIM:
      return calculateVWAPReclaimStage(quote);
    case StrategyType.ORB5:
      return calculateORBStage(quote, 5);
    case StrategyType.ORB15:
      return calculateORBStage(quote, 15);
    case StrategyType.HIGH_RVOL:
      return calculateHighRVOLStage(quote);
    case StrategyType.GAP_AND_GO:
      return calculateGapAndGoStage(quote);
    case StrategyType.TREND_CONTINUATION:
      return calculateTrendContinuationStage(quote);
    case StrategyType.VOLATILITY_SQUEEZE:
      return calculateVolatilitySqueezeStage(quote);
    default:
      return calculateVCPStage(quote);
  }
}

export function isBullishQuote(quote: QuoteData): boolean {
  if (quote.changePercent < -2) return false;
  const priceFromHigh = quote.high > 0 ? ((quote.high - quote.last) / quote.high) * 100 : 0;
  if (priceFromHigh > 8 && quote.changePercent < 0) return false;
  if (quote.prevClose && quote.last < quote.prevClose * 0.97) return false;
  return true;
}

export function isBullishScanResult(r: { price?: number | null; changePercent?: number | null; ema9?: number | null; ema21?: number | null }): boolean {
  if ((r.changePercent ?? 0) < -3) return false;
  const e9 = r.ema9 ?? 0;
  const e21 = r.ema21 ?? 0;
  if (e9 > 0 && e21 > 0 && e9 < e21 * 0.97) return false;
  return true;
}

export function quotesToScanResults(quotes: QuoteData[], strategy: string = StrategyType.VCP): ScanResult[] {
  const results: ScanResult[] = [];
  let bullishFiltered = 0;

  for (const quote of quotes) {
    if (!isBullishQuote(quote)) {
      bullishFiltered++;
      continue;
    }

    const strategyId = strategy as import("./strategies/types").StrategyIdType;
    const classified = classifyQuote(strategyId, quote);

    if (classified) {
      results.push({
        id: randomUUID(),
        scanRunId: null,
        ticker: classified.symbol,
        name: classified.name,
        price: classified.price,
        change: classified.change,
        changePercent: classified.changePercent,
        volume: classified.volume,
        avgVolume: classified.avgVolume,
        rvol: classified.rvol,
        stage: classified.stage,
        resistance: classified.resistance,
        stopLoss: classified.stopLevel,
        patternScore: classified.score,
        ema9: classified.ema9,
        ema21: classified.ema21,
        atr: Number((quote.last * 0.02).toFixed(2)),
        createdAt: new Date(),
        strategy: strategy,
      });
      continue;
    }

    const stage = calculateStageForStrategy(quote, strategy);
    const highPrice = quote.high && quote.high > 0 ? quote.high : quote.last;
    const resistance = highPrice * 1.02;
    const stopLoss = quote.last * 0.93;

    results.push({
      id: randomUUID(),
      scanRunId: null,
      ticker: quote.symbol,
      name: quote.symbol,
      price: Number(quote.last.toFixed(2)),
      change: Number(quote.change.toFixed(2)),
      changePercent: Number(quote.changePercent.toFixed(2)),
      volume: quote.volume,
      avgVolume: quote.avgVolume || null,
      rvol: quote.avgVolume ? Number((quote.volume / quote.avgVolume).toFixed(2)) : null,
      stage,
      resistance: Number(resistance.toFixed(2)),
      stopLoss: Number(stopLoss.toFixed(2)),
      patternScore: 50,
      ema9: Number((quote.last * 0.99).toFixed(2)),
      ema21: Number((quote.last * 0.97).toFixed(2)),
      atr: Number((quote.last * 0.02).toFixed(2)),
      createdAt: new Date(),
      strategy: strategy,
    });
  }

  if (bullishFiltered > 0) {
    console.log(`[quotesToScanResults] ${bullishFiltered}/${quotes.length} quotes filtered by isBullishQuote, ${results.length} results generated`);
  }

  return results;
}

import { vcpMultidayStrategy } from "./strategies/vcpMultiday";
import { Candle } from "./strategies/types";

function computeEMA(values: number[], period: number): number {
  if (values.length === 0) return 0;
  if (values.length < period) {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

export async function verifyBullishTrend(
  connection: DecryptedBrokerConnection,
  results: ScanResult[]
): Promise<ScanResult[]> {
  if (results.length === 0) return results;
  const CONCURRENCY = 5;
  const verified: ScanResult[] = [];
  let historyErrors = 0;

  async function check(r: ScanResult): Promise<ScanResult | null> {
    try {
      const candles = await fetchHistoryFromBroker(connection, r.ticker, "3M");
      if (!candles || candles.length < 21) {
        r.ema9 = Number((r.price * 0.99).toFixed(2));
        r.ema21 = Number((r.price * 0.97).toFixed(2));
        return r;
      }
      const closes = candles.map(c => c.close);
      const ema9 = computeEMA(closes, 9);
      const ema21 = computeEMA(closes, 21);
      const ema50 = closes.length >= 50 ? computeEMA(closes, 50) : 0;
      const currentPrice = closes[closes.length - 1];
      r.ema9 = Number(ema9.toFixed(2));
      r.ema21 = Number(ema21.toFixed(2));
      return r;
    } catch (err: any) {
      historyErrors++;
      if (historyErrors <= 3) {
        console.warn(`[BullishVerify] History fetch failed for ${r.ticker}: ${err.message}`);
      }
      r.ema9 = Number((r.price * 0.99).toFixed(2));
      r.ema21 = Number((r.price * 0.97).toFixed(2));
      return r;
    }
  }

  for (let i = 0; i < results.length; i += CONCURRENCY) {
    const batch = results.slice(i, i + CONCURRENCY);
    const checked = await Promise.all(batch.map(check));
    verified.push(...checked.filter((r): r is ScanResult => r !== null));
    if (i + CONCURRENCY < results.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  if (historyErrors > 0) {
    console.warn(`[BullishVerify] ${historyErrors}/${results.length} history fetches failed (provider: ${connection.provider}), results included with estimated EMAs`);
  }

  return verified;
}

export async function runMultidayScan(
  connection: DecryptedBrokerConnection,
  quotes: QuoteData[]
): Promise<ScanResult[]> {
  const CONCURRENCY = 5;
  const results: ScanResult[] = [];
  
  async function processQuote(quote: QuoteData): Promise<ScanResult | null> {
    if (!isBullishQuote(quote)) return null;
    try {
      const candles = await fetchHistoryFromBroker(connection, quote.symbol, "3M");
      
      const strategyCandles: Candle[] = candles.map(c => ({
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        timestamp: new Date(c.time),
      }));
      
      const classification = vcpMultidayStrategy.classify(quote, strategyCandles);
      
      return {
        id: randomUUID(),
        scanRunId: null,
        ticker: quote.symbol,
        name: quote.symbol,
        price: Number(quote.last.toFixed(2)),
        change: Number(quote.change.toFixed(2)),
        changePercent: Number(quote.changePercent.toFixed(2)),
        volume: quote.volume,
        avgVolume: quote.avgVolume !== undefined ? quote.avgVolume : null,
        rvol: classification.rvol != null ? Number(classification.rvol.toFixed(2)) : null,
        stage: classification.stage,
        resistance: classification.levels.resistance ?? Number((quote.last * 1.02).toFixed(2)),
        stopLoss: classification.levels.stopLevel ?? Number((quote.last * 0.93).toFixed(2)),
        patternScore: classification.score,
        ema9: classification.ema9 ? Number(classification.ema9.toFixed(2)) : Number((quote.last * 0.99).toFixed(2)),
        ema21: classification.ema21 ? Number(classification.ema21.toFixed(2)) : Number((quote.last * 0.97).toFixed(2)),
        atr: Number((quote.last * 0.02).toFixed(2)),
        createdAt: new Date(),
        strategy: StrategyType.VCP_MULTIDAY,
      };
    } catch (error) {
      console.error(`Failed to run multiday scan for ${quote.symbol}:`, error);
      return null;
    }
  }
  
  for (let i = 0; i < quotes.length; i += CONCURRENCY) {
    const batch = quotes.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(processQuote));
    results.push(...batchResults.filter((r): r is ScanResult => r !== null));
  }
  
  return results;
}

// Re-export symbol universes
export { DOW_30, NASDAQ_100, SP_500, ALL_MAJOR_INDICES, UNIVERSE_OPTIONS, getUniverseSymbols } from "./symbol-universes";
import { DOW_30, NASDAQ_100, SP_500, ALL_MAJOR_INDICES } from "./symbol-universes";

// Default to Dow 30 for quick scans (legacy compatibility)
export const DEFAULT_SCAN_SYMBOLS = DOW_30;

// Legacy exports for backward compatibility
export const DOW_30_SYMBOLS = DOW_30;
export const NASDAQ_100_TOP = NASDAQ_100.slice(0, 30);
export const SP500_TOP = SP_500.slice(0, 30);

// Use the comprehensive ALL_MAJOR_INDICES for large cap universe
export const LARGE_CAP_UNIVERSE = ALL_MAJOR_INDICES;

export interface CandleData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function isIntradayTimeframe(timeframe: string): boolean {
  return ["1m", "5m", "15m", "30m", "1h"].includes(timeframe);
}

function getDateRange(timeframe: string): { start: string; end: string; isIntraday: boolean } {
  const now = new Date();
  let startDate = new Date(now);
  const isIntraday = isIntradayTimeframe(timeframe) || timeframe === "1D";
  
  switch (timeframe) {
    case "1m":
      startDate.setDate(startDate.getDate() - 1); // 1 day of 1-min data
      break;
    case "5m":
    case "15m":
    case "30m":
    case "1h":
      startDate.setDate(startDate.getDate() - 5);
      break;
    case "1D":
      startDate.setDate(startDate.getDate() - 1);
      break;
    case "1W":
      startDate.setDate(startDate.getDate() - 7);
      break;
    case "1M":
      startDate.setMonth(startDate.getMonth() - 1);
      break;
    case "3M":
      startDate.setMonth(startDate.getMonth() - 3);
      break;
    case "6M":
      startDate.setMonth(startDate.getMonth() - 6);
      break;
    case "1Y":
      startDate.setFullYear(startDate.getFullYear() - 1);
      break;
    case "2Y":
      startDate.setFullYear(startDate.getFullYear() - 2);
      break;
    case "5Y":
      startDate.setFullYear(startDate.getFullYear() - 5);
      break;
    default:
      startDate.setMonth(startDate.getMonth() - 3);
  }
  
  if (isIntraday) {
    return { 
      start: startDate.toISOString().replace('Z', ''),
      end: now.toISOString().replace('Z', ''),
      isIntraday 
    };
  }
  
  return { 
    start: startDate.toISOString().split('T')[0], 
    end: now.toISOString().split('T')[0],
    isIntraday 
  };
}

export function getTimeframeForDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffMs = end.getTime() - start.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  
  if (diffDays <= 30) return "1M";
  if (diffDays <= 90) return "3M";
  if (diffDays <= 180) return "6M";
  if (diffDays <= 365) return "1Y";
  if (diffDays <= 730) return "2Y";
  return "5Y";
}

function getTradierInterval(timeframe: string): string {
  switch (timeframe) {
    case "1m": return "1min";
    case "5m": return "5min";
    case "15m": return "15min";
    case "30m": return "30min";
    case "1h": return "60min";
    case "1D": return "5min";
    default: return "daily";
  }
}

function getPolygonParams(timeframe: string): { multiplier: number; span: string } {
  switch (timeframe) {
    case "1m": return { multiplier: 1, span: "minute" };
    case "5m": return { multiplier: 5, span: "minute" };
    case "15m": return { multiplier: 15, span: "minute" };
    case "30m": return { multiplier: 30, span: "minute" };
    case "1h": return { multiplier: 1, span: "hour" };
    case "1D": return { multiplier: 5, span: "minute" };
    default: return { multiplier: 1, span: "day" };
  }
}

function getAlpacaTimeframe(timeframe: string): string {
  switch (timeframe) {
    case "1m": return "1Min";
    case "5m": return "5Min";
    case "15m": return "15Min";
    case "30m": return "30Min";
    case "1h": return "1Hour";
    case "1D": return "5Min";
    default: return "1Day";
  }
}

export async function fetchTradierHistory(
  accessToken: string,
  symbol: string,
  timeframe: string
): Promise<CandleData[]> {
  const { start, end, isIntraday } = getDateRange(timeframe);
  const interval = getTradierInterval(timeframe);
  
  // Include extended hours session for pre-market and after-hours data
  const endpoint = isIntraday 
    ? `https://api.tradier.com/v1/markets/timesales?symbol=${symbol}&interval=${interval}&start=${start}&end=${end}&session_filter=all`
    : `https://api.tradier.com/v1/markets/history?symbol=${symbol}&interval=${interval}&start=${start}&end=${end}`;
  
  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Tradier history API error: ${response.status}`);
  }

  const data = await response.json();
  
  if (isIntraday) {
    const series = data.series?.data;
    if (!series) return [];
    const seriesArray = Array.isArray(series) ? series : [series];
    return seriesArray.map((d: any) => ({
      time: d.time || d.timestamp,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    }));
  }
  
  const history = data.history?.day;
  if (!history) return [];
  const historyArray = Array.isArray(history) ? history : [history];
  
  return historyArray.map((d: any) => ({
    time: d.date,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    volume: d.volume,
  }));
}

export async function fetchPolygonHistory(
  accessToken: string,
  symbol: string,
  timeframe: string
): Promise<CandleData[]> {
  const { start, end, isIntraday } = getDateRange(timeframe);
  const { multiplier, span } = getPolygonParams(timeframe);
  
  // Split-adjusted prices (Polygon aggregates include consolidated market data)
  const response = await fetch(
    `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/${multiplier}/${span}/${start}/${end}?apiKey=${accessToken}&limit=5000&adjusted=true`
  );

  if (!response.ok) {
    throw new Error(`Polygon history API error: ${response.status}`);
  }

  const data = await response.json();
  const results = data.results || [];
  
  return results.map((d: any) => ({
    time: isIntraday ? new Date(d.t).toISOString() : new Date(d.t).toISOString().split('T')[0],
    open: d.o,
    high: d.h,
    low: d.l,
    close: d.c,
    volume: d.v,
  }));
}

export async function fetchAlpacaHistory(
  accessToken: string,
  secretKey: string | null,
  symbol: string,
  timeframe: string
): Promise<CandleData[]> {
  const { start, end, isIntraday } = getDateRange(timeframe);
  const tf = getAlpacaTimeframe(timeframe);
  
  const headers: Record<string, string> = {
    "APCA-API-KEY-ID": accessToken,
  };
  if (secretKey) {
    headers["APCA-API-SECRET-KEY"] = secretKey;
  }

  // Use SIP feed for extended hours data (pre-market and after-hours)
  const response = await fetch(
    `https://data.alpaca.markets/v2/stocks/${symbol}/bars?timeframe=${tf}&start=${start}&end=${end}&feed=sip`,
    { headers }
  );

  if (!response.ok) {
    throw new Error(`Alpaca history API error: ${response.status}`);
  }

  const data = await response.json();
  const bars = data.bars || [];
  
  return bars.map((d: any) => ({
    time: isIntraday ? d.t : d.t.split('T')[0],
    open: d.o,
    high: d.h,
    low: d.l,
    close: d.c,
    volume: d.v,
  }));
}

export async function fetchTastyTradeHistory(
  accessToken: string,
  secretKey: string | null,
  symbol: string,
  timeframe: string
): Promise<CandleData[]> {
  const { start, end, isIntraday } = getDateRange(timeframe);
  
  const periodType = isIntraday ? "minute" : "day";
  const period = isIntraday ? 5 : 1;
  
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  const response = await fetch(
    `https://api.tastytrade.com/market-data/candles/${symbol}?start=${start}&end=${end}&periodType=${periodType}&period=${period}`,
    { headers }
  );

  if (!response.ok) {
    throw new Error(`TastyTrade history API error: ${response.status}`);
  }

  const data = await response.json();
  const candles = data.data?.candles || [];
  
  return candles.map((d: any) => ({
    time: isIntraday ? d.time : d.time.split('T')[0],
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    volume: d.volume,
  }));
}

export async function fetchTradeStationHistory(
  accessToken: string,
  secretKey: string | null,
  symbol: string,
  timeframe: string,
  simMode?: boolean
): Promise<CandleData[]> {
  const { start, end, isIntraday } = getDateRange(timeframe);
  
  let interval = "Daily";
  if (isIntraday) {
    switch (timeframe) {
      case "5m": interval = "5"; break;
      case "15m": interval = "15"; break;
      case "30m": interval = "30"; break;
      case "1h": interval = "60"; break;
      case "1D": interval = "5"; break;
    }
  }
  
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  const tsBase = getTradeStationBaseUrl(simMode);
  const unit = isIntraday ? "Minute" : "Daily";
  const response = await fetch(
    `${tsBase}/marketdata/barcharts/${symbol}?interval=${interval}&unit=${unit}&startDate=${start}&endDate=${end}`,
    { headers }
  );

  if (!response.ok) {
    throw new Error(`TradeStation history API error: ${response.status}`);
  }

  const data = await response.json();
  const bars = data.Bars || [];
  
  return bars.map((d: any) => ({
    time: isIntraday ? d.TimeStamp : d.TimeStamp.split('T')[0],
    open: d.Open,
    high: d.High,
    low: d.Low,
    close: d.Close,
    volume: d.TotalVolume,
  }));
}

export async function fetchHistoryFromBroker(
  connection: DecryptedBrokerConnection,
  symbol: string,
  timeframe: string
): Promise<CandleData[]> {
  if (!connection.accessToken) {
    throw new Error("No access token available");
  }

  switch (connection.provider) {
    case "tradier":
      return fetchTradierHistory(connection.accessToken, symbol, timeframe);
    case "polygon":
      return fetchPolygonHistory(connection.accessToken, symbol, timeframe);
    case "alpaca":
      return fetchAlpacaHistory(connection.accessToken, connection.refreshToken ?? null, symbol, timeframe);
    case "tastytrade":
      return fetchTastyTradeHistory(connection.accessToken, connection.refreshToken ?? null, symbol, timeframe);
    case "tradestation":
      return fetchTradeStationHistory(connection.accessToken, connection.refreshToken ?? null, symbol, timeframe, connection.simMode);
    default:
      throw new Error(`Provider ${connection.provider} not supported for historical data`);
  }
}

export async function fetchHistoryWithDateRange(
  connection: DecryptedBrokerConnection,
  symbol: string,
  startDate: string,
  endDate: string
): Promise<CandleData[]> {
  if (!connection.accessToken) {
    throw new Error("No access token available");
  }

  let candles: CandleData[] = [];
  
  try {
    switch (connection.provider) {
      case "tradier":
        candles = await fetchTradierHistoryWithDates(connection.accessToken, symbol, startDate, endDate);
        break;
      case "polygon":
        candles = await fetchPolygonHistoryWithDates(connection.accessToken, symbol, startDate, endDate);
        break;
      case "alpaca":
        candles = await fetchAlpacaHistoryWithDates(connection.accessToken, connection.refreshToken ?? null, symbol, startDate, endDate);
        break;
      case "tastytrade":
        candles = await fetchTastyTradeHistoryWithDates(connection.accessToken, connection.refreshToken ?? null, symbol, startDate, endDate);
        break;
      case "tradestation":
        candles = await fetchTradeStationHistoryWithDates(connection.accessToken, connection.refreshToken ?? null, symbol, startDate, endDate, connection.simMode);
        break;
      default:
        try {
          const fallbackCandles = await fetchHistoryFromBroker(connection, symbol, "5Y");
          candles = fallbackCandles.filter(c => {
            const candleDate = c.time.split('T')[0];
            return candleDate >= startDate && candleDate <= endDate;
          });
        } catch {
          throw new Error(`Provider ${connection.provider} does not support historical data for backtesting. Try connecting Tradier, Polygon, or Alpaca.`);
        }
    }
  } catch (error: any) {
    throw new Error(`Failed to fetch historical data: ${error.message}`);
  }
  
  candles = candles.map(c => ({
    ...c,
    time: c.time.includes('T') ? c.time.split('T')[0] : c.time,
  }));
  
  const uniqueCandles = new Map<string, CandleData>();
  for (const candle of candles) {
    if (!uniqueCandles.has(candle.time) || candle.volume > (uniqueCandles.get(candle.time)?.volume || 0)) {
      uniqueCandles.set(candle.time, candle);
    }
  }
  
  const sortedCandles = Array.from(uniqueCandles.values());
  sortedCandles.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  
  return sortedCandles;
}

async function fetchTradierHistoryWithDates(
  accessToken: string,
  symbol: string,
  startDate: string,
  endDate: string
): Promise<CandleData[]> {
  const endpoint = `https://api.tradier.com/v1/markets/history?symbol=${symbol}&interval=daily&start=${startDate}&end=${endDate}`;
  
  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Tradier history API error: ${response.status}`);
  }

  const data = await response.json();
  const history = data.history?.day;
  if (!history) return [];
  const historyArray = Array.isArray(history) ? history : [history];
  
  return historyArray.map((d: any) => ({
    time: d.date,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    volume: d.volume,
  }));
}

async function fetchPolygonHistoryWithDates(
  accessToken: string,
  symbol: string,
  startDate: string,
  endDate: string
): Promise<CandleData[]> {
  // Split-adjusted prices (Polygon aggregates include consolidated market data)
  const response = await fetch(
    `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${startDate}/${endDate}?apiKey=${accessToken}&limit=50000&adjusted=true`
  );

  if (!response.ok) {
    throw new Error(`Polygon history API error: ${response.status}`);
  }

  const data = await response.json();
  const results = data.results || [];
  
  return results.map((d: any) => ({
    time: new Date(d.t).toISOString().split('T')[0],
    open: d.o,
    high: d.h,
    low: d.l,
    close: d.c,
    volume: d.v,
  }));
}

async function fetchAlpacaHistoryWithDates(
  accessToken: string,
  secretKey: string | null,
  symbol: string,
  startDate: string,
  endDate: string
): Promise<CandleData[]> {
  const headers: Record<string, string> = {
    "APCA-API-KEY-ID": accessToken,
  };
  if (secretKey) {
    headers["APCA-API-SECRET-KEY"] = secretKey;
  }

  // Use SIP feed for extended hours data (pre-market and after-hours)
  const response = await fetch(
    `https://data.alpaca.markets/v2/stocks/${symbol}/bars?timeframe=1Day&start=${startDate}&end=${endDate}&limit=10000&feed=sip`,
    { headers }
  );

  if (!response.ok) {
    throw new Error(`Alpaca history API error: ${response.status}`);
  }

  const data = await response.json();
  const bars = data.bars || [];
  
  return bars.map((d: any) => ({
    time: d.t.split('T')[0],
    open: d.o,
    high: d.h,
    low: d.l,
    close: d.c,
    volume: d.v,
  }));
}

async function fetchTastyTradeHistoryWithDates(
  accessToken: string,
  secretKey: string | null,
  symbol: string,
  startDate: string,
  endDate: string
): Promise<CandleData[]> {
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  const response = await fetch(
    `https://api.tastyworks.com/market-data/symbols/${symbol}/candles?period-type=day&period=1&start-time=${startDate}T00:00:00Z&end-time=${endDate}T23:59:59Z`,
    { headers }
  );

  if (!response.ok) {
    throw new Error(`TastyTrade history API error: ${response.status}`);
  }

  const data = await response.json();
  const candles = data.data?.candles || [];
  
  return candles.map((d: any) => ({
    time: d.time.split('T')[0],
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    volume: d.volume,
  }));
}

async function fetchTradeStationHistoryWithDates(
  accessToken: string,
  secretKey: string | null,
  symbol: string,
  startDate: string,
  endDate: string,
  simMode?: boolean
): Promise<CandleData[]> {
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  const tsBase = getTradeStationBaseUrl(simMode);
  const response = await fetch(
    `${tsBase}/marketdata/barcharts/${symbol}?interval=1&unit=Daily&startDate=${startDate}&endDate=${endDate}`,
    { headers }
  );

  if (!response.ok) {
    throw new Error(`TradeStation history API error: ${response.status}`);
  }

  const data = await response.json();
  const bars = data.Bars || [];
  
  return bars.map((d: any) => ({
    time: d.TimeStamp.split('T')[0],
    open: d.Open,
    high: d.High,
    low: d.Low,
    close: d.Close,
    volume: d.TotalVolume,
  }));
}

function calculateEMA(data: number[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);
  
  let sum = 0;
  for (let i = 0; i < Math.min(period, data.length); i++) {
    sum += data[i];
    ema.push(sum / (i + 1));
  }
  
  for (let i = period; i < data.length; i++) {
    const value = (data[i] - ema[i - 1]) * multiplier + ema[i - 1];
    ema.push(value);
  }
  
  return ema;
}

export function processChartData(candles: CandleData[], ticker: string): {
  candles: CandleData[];
  ema9: number[];
  ema21: number[];
  ema50: number[];
  resistance: number;
  stopLoss: number;
  ticker: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  avgVolume: number;
  atr: number;
  rvol: number;
  stage: string;
  contractionZones: Array<{ start: string; end: string; highLevel: number; lowLevel: number }>;
  vcpAnnotations: Array<{ time: string; price: number; type: string; label?: string }>;
} {
  if (!candles.length) {
    return {
      candles: [],
      ema9: [],
      ema21: [],
      ema50: [],
      resistance: 100,
      stopLoss: 90,
      ticker,
      name: ticker,
      price: 100,
      change: 0,
      changePercent: 0,
      volume: 0,
      avgVolume: 0,
      atr: 2,
      rvol: 1,
      stage: "FORMING",
      contractionZones: [],
      vcpAnnotations: [],
    };
  }

  const closes = candles.map(c => c.close);
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);
  
  const last = candles[candles.length - 1];
  const prev = candles.length > 1 ? candles[candles.length - 2] : last;
  
  const highestHigh = Math.max(...candles.slice(-20).map(c => c.high));
  const resistance = highestHigh * 1.02;
  const stopLoss = last.close * 0.93;
  
  const volumes = candles.map(c => c.volume);
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const rvol = avgVolume > 0 ? last.volume / avgVolume : 1;
  
  const ranges = candles.slice(-14).map(c => c.high - c.low);
  const atr = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  
  const change = last.close - prev.close;
  const changePercent = prev.close > 0 ? (change / prev.close) * 100 : 0;
  
  const priceFromHigh = ((highestHigh - last.close) / highestHigh) * 100;
  let stage = "FORMING";
  if (change > 0 && changePercent > 2) {
    stage = "BREAKOUT";
  } else if (priceFromHigh < 5 && change > 0) {
    stage = "READY";
  } else if (priceFromHigh < 2) {
    stage = "APPROACHING";
  }

  const contractionZones: Array<{ start: string; end: string; highLevel: number; lowLevel: number }> = [];
  const vcpAnnotations: Array<{ time: string; price: number; type: string; label?: string }> = [];
  
  if (candles.length > 20) {
    const recentCandles = candles.slice(-30);
    let zoneStart = recentCandles[0].time;
    let zoneHigh = recentCandles[0].high;
    let zoneLow = recentCandles[0].low;
    
    for (let i = 1; i < recentCandles.length; i++) {
      const c = recentCandles[i];
      if (c.high > zoneHigh * 1.02 || c.low < zoneLow * 0.98) {
        if (i > 5) {
          contractionZones.push({
            start: zoneStart,
            end: recentCandles[i - 1].time,
            highLevel: zoneHigh,
            lowLevel: zoneLow,
          });
        }
        zoneStart = c.time;
        zoneHigh = c.high;
        zoneLow = c.low;
      } else {
        zoneHigh = Math.max(zoneHigh, c.high);
        zoneLow = Math.min(zoneLow, c.low);
      }
    }
    
    if (highestHigh === last.high) {
      vcpAnnotations.push({
        time: last.time,
        price: last.high,
        type: "pivot_high",
        label: "Pivot High",
      });
    }
  }

  return {
    candles,
    ema9,
    ema21,
    ema50,
    resistance: Number(resistance.toFixed(2)),
    stopLoss: Number(stopLoss.toFixed(2)),
    ticker,
    name: ticker,
    price: Number(last.close.toFixed(2)),
    change: Number(change.toFixed(2)),
    changePercent: Number(changePercent.toFixed(2)),
    volume: last.volume,
    avgVolume: Math.round(avgVolume),
    atr: Number(atr.toFixed(2)),
    rvol: Number(rvol.toFixed(2)),
    stage,
    contractionZones,
    vcpAnnotations,
  };
}
