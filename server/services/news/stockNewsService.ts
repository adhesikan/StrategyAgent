/**
 * StockNews API wrapper for the News Sentiment engine.
 *
 * Falls back to deterministic mock articles when no key is configured.
 */

export interface NormalizedArticle {
  headline: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: string;
  symbols: string[];
}

const STOCKNEWS_BASE = "https://stocknewsapi.com/api/v1";

function getToken(): string | null {
  return process.env.STOCKNEWS_API_KEY || process.env.STOCKNEWSAPI_TOKEN || null;
}

export function isStockNewsConfigured(): boolean {
  return !!getToken();
}

function safeIso(d: string | undefined): string {
  if (!d) return new Date().toISOString();
  const t = Date.parse(d);
  if (Number.isNaN(t)) return new Date().toISOString();
  return new Date(t).toISOString();
}

function mapItem(item: any): NormalizedArticle {
  const symbols = Array.isArray(item.tickers)
    ? item.tickers
    : typeof item.tickers === "string"
      ? item.tickers.split(",").map((s: string) => s.trim()).filter(Boolean)
      : [];
  return {
    headline: String(item.title ?? "").trim(),
    summary: String(item.text ?? item.summary ?? "").trim(),
    source: String(item.source_name ?? item.source ?? "Unknown"),
    url: String(item.news_url ?? item.url ?? ""),
    publishedAt: safeIso(item.date),
    symbols: symbols.map((s: string) => s.toUpperCase()),
  };
}

const MOCK_TEMPLATES = [
  { fmt: "{S} stays in focus as traders weigh sector momentum", impact: "neutral" },
  { fmt: "{S} pops on stronger-than-expected guidance commentary", impact: "bullish" },
  { fmt: "{S} pulls back as analysts trim short-term targets", impact: "bearish" },
  { fmt: "{S} trades sideways ahead of upcoming product event", impact: "neutral" },
  { fmt: "{S} catches a bid amid AI capex optimism in the group", impact: "bullish" },
  { fmt: "{S} slides on broader market risk-off flows", impact: "bearish" },
];

function symbolHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function mockArticles(symbol: string, items: number): NormalizedArticle[] {
  const out: NormalizedArticle[] = [];
  const base = symbolHash(symbol);
  const now = Date.now();
  for (let i = 0; i < items; i++) {
    const t = MOCK_TEMPLATES[(base + i) % MOCK_TEMPLATES.length];
    const published = new Date(now - i * 1000 * 60 * 60 * 2).toISOString();
    out.push({
      headline: t.fmt.replace("{S}", symbol),
      summary: `Mock article ${i + 1} for ${symbol}. Sentiment direction is ${t.impact}. This is informational simulated content used because no live news provider is configured.`,
      source: ["MarketWire (mock)", "TickerTimes (mock)", "TradingDigest (mock)"][i % 3],
      url: `https://example.com/mock/${symbol.toLowerCase()}-${i}`,
      publishedAt: published,
      symbols: [symbol],
    });
  }
  return out;
}

export async function fetchLatestNews(
  symbols: string[],
  itemsPerSymbol = 6,
): Promise<NormalizedArticle[]> {
  const token = getToken();
  const cleaned = Array.from(new Set(symbols.map((s) => s.toUpperCase()))).slice(0, 25);
  if (!token) {
    return cleaned.flatMap((s) => mockArticles(s, Math.min(itemsPerSymbol, 4)));
  }

  const all: NormalizedArticle[] = [];
  for (const sym of cleaned) {
    try {
      const url = `${STOCKNEWS_BASE}?tickers=${encodeURIComponent(sym)}&items=${itemsPerSymbol}&token=${token}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) {
        console.warn(`[stockNews] ${sym} non-OK ${res.status}, falling back to mocks for symbol`);
        all.push(...mockArticles(sym, Math.min(itemsPerSymbol, 3)));
        continue;
      }
      const data = await res.json();
      if (!Array.isArray(data?.data)) {
        all.push(...mockArticles(sym, Math.min(itemsPerSymbol, 3)));
        continue;
      }
      all.push(...data.data.map(mapItem));
    } catch (err) {
      console.warn(`[stockNews] fetch failed for ${sym}:`, err);
      all.push(...mockArticles(sym, Math.min(itemsPerSymbol, 3)));
    }
  }
  return all;
}

export async function fetchTrendingNews(items = 25): Promise<NormalizedArticle[]> {
  const token = getToken();
  if (!token) {
    const symbols = ["AAPL", "MSFT", "NVDA", "AMD", "TSLA", "META", "AMZN", "GOOGL", "SPY", "QQQ"];
    return symbols.flatMap((s) => mockArticles(s, 2)).slice(0, items);
  }
  try {
    const url = `${STOCKNEWS_BASE}/category?section=general&items=${items}&token=${token}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      console.warn(`[stockNews] trending non-OK ${res.status}, returning mocks`);
      return fetchTrendingNews_mockOnly(items);
    }
    const data = await res.json();
    if (!Array.isArray(data?.data)) return fetchTrendingNews_mockOnly(items);
    return data.data.map(mapItem);
  } catch (err) {
    console.warn(`[stockNews] trending fetch failed:`, err);
    return fetchTrendingNews_mockOnly(items);
  }
}

function fetchTrendingNews_mockOnly(items: number): NormalizedArticle[] {
  const symbols = ["AAPL", "MSFT", "NVDA", "AMD", "TSLA", "META", "AMZN", "GOOGL", "SPY", "QQQ"];
  return symbols.flatMap((s) => mockArticles(s, 2)).slice(0, items);
}
