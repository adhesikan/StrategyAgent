import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Newspaper, Search, ExternalLink, AlertCircle, Info, TrendingUp, Briefcase, Globe, Clock } from "lucide-react";
import type { BrokerConnection } from "@shared/schema";

interface NewsArticle {
  title: string;
  source: string;
  date: string;
  url: string;
  imageUrl?: string;
}

interface NewsResponse {
  ok: boolean;
  ticker?: string;
  items?: number;
  articles?: NewsArticle[];
  error?: string;
}

interface PlatformUniverse {
  id: string;
  name: string;
  count: number;
  symbols?: string[];
}

interface BrokerPosition {
  symbol: string;
  qty: number;
  avgPrice: number;
  marketPrice: number;
  unrealizedPnl: number;
}

const STORAGE_KEY = "vcp_last_news_ticker";
const RECENT_SEARCHES_KEY = "vcp_news_recent_searches";
const MARKET_TICKERS = ["SPY", "QQQ", "IWM"];

function getRecentSearches(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function addRecentSearch(ticker: string) {
  const recent = getRecentSearches().filter(t => t !== ticker);
  recent.unshift(ticker);
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recent.slice(0, 5)));
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffHours < 1) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return `${diffMins} min ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else {
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
      });
    }
  } catch {
    return dateStr;
  }
}

export default function NewsPage() {
  const [ticker, setTicker] = useState("");
  const [searchTicker, setSearchTicker] = useState("SPY");
  const [items, setItems] = useState("10");
  const [recentSearches, setRecentSearches] = useState<string[]>(getRecentSearches);

  const { data: universes } = useQuery<PlatformUniverse[]>({
    queryKey: ["/api/platform/universes"],
  });

  const { data: brokerStatus } = useQuery<BrokerConnection | null>({
    queryKey: ["/api/broker/status"],
  });

  const { data: positions } = useQuery<BrokerPosition[]>({
    queryKey: ["/api/broker/positions"],
    enabled: !!brokerStatus?.isConnected,
  });

  const { data, isLoading, error, isFetching } = useQuery<NewsResponse>({
    queryKey: ["/api/news", { ticker: searchTicker, items }],
    queryFn: async () => {
      const response = await fetch(`/api/news?ticker=${encodeURIComponent(searchTicker)}&items=${items}`);
      return response.json();
    },
    enabled: !!searchTicker,
  });

  const handleSearch = () => {
    const cleanTicker = ticker.trim().toUpperCase();
    if (cleanTicker) {
      setSearchTicker(cleanTicker);
      addRecentSearch(cleanTicker);
      setRecentSearches(getRecentSearches());
      localStorage.setItem(STORAGE_KEY, cleanTicker);
    }
  };

  const handleChipClick = (t: string) => {
    setTicker(t);
    setSearchTicker(t);
    addRecentSearch(t);
    setRecentSearches(getRecentSearches());
    localStorage.setItem(STORAGE_KEY, t);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const universeSymbols = universes?.[0]?.symbols?.slice(0, 5) ?? [];
  const positionSymbols = positions?.map(p => p.symbol).slice(0, 5) ?? [];

  return (
    <div className="container max-w-4xl mx-auto p-4 space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Newspaper className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold" data-testid="text-news-title">News</h1>
        </div>
        <p className="text-sm text-muted-foreground" data-testid="text-news-subtitle">
          Recent headlines for research purposes only.
        </p>
      </div>

      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <Input
                placeholder="Enter ticker (e.g., AAPL)"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                onKeyDown={handleKeyDown}
                className="uppercase"
                data-testid="input-news-ticker"
              />
            </div>
            <Select value={items} onValueChange={setItems}>
              <SelectTrigger className="w-full sm:w-28" data-testid="select-news-items">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5 items</SelectItem>
                <SelectItem value="10">10 items</SelectItem>
                <SelectItem value="15">15 items</SelectItem>
                <SelectItem value="20">20 items</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={handleSearch}
              disabled={!ticker.trim() || isFetching}
              data-testid="button-news-search"
            >
              <Search className="h-4 w-4 mr-2" />
              Search
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-1.5">
              <Globe className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Market:</span>
              {MARKET_TICKERS.map((t) => (
                <Badge
                  key={t}
                  variant={searchTicker === t ? "default" : "outline"}
                  className="cursor-pointer text-xs"
                  onClick={() => handleChipClick(t)}
                  data-testid={`chip-market-${t.toLowerCase()}`}
                >
                  {t}
                </Badge>
              ))}
            </div>

            {universeSymbols.length > 0 && (
              <div className="flex items-center gap-1.5">
                <TrendingUp className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Universe:</span>
                {universeSymbols.map((t) => (
                  <Badge
                    key={t}
                    variant={searchTicker === t ? "default" : "outline"}
                    className="cursor-pointer text-xs"
                    onClick={() => handleChipClick(t)}
                    data-testid={`chip-universe-${t.toLowerCase()}`}
                  >
                    {t}
                  </Badge>
                ))}
              </div>
            )}

            {positionSymbols.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Briefcase className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Positions:</span>
                {positionSymbols.map((t) => (
                  <Badge
                    key={t}
                    variant={searchTicker === t ? "default" : "outline"}
                    className="cursor-pointer text-xs"
                    onClick={() => handleChipClick(t)}
                    data-testid={`chip-position-${t.toLowerCase()}`}
                  >
                    {t}
                  </Badge>
                ))}
              </div>
            )}

            {recentSearches.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Recent:</span>
                {recentSearches.filter(t => !MARKET_TICKERS.includes(t)).slice(0, 3).map((t) => (
                  <Badge
                    key={t}
                    variant={searchTicker === t ? "default" : "outline"}
                    className="cursor-pointer text-xs"
                    onClick={() => handleChipClick(t)}
                    data-testid={`chip-recent-${t.toLowerCase()}`}
                  >
                    {t}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {(isLoading || isFetching) && searchTicker && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex gap-4">
                  <Skeleton className="h-14 w-14 rounded flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {error && (
        <Alert variant="destructive" data-testid="alert-news-error">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Couldn't load headlines right now. Try again.
          </AlertDescription>
        </Alert>
      )}

      {data && !data.ok && !isFetching && (
        <Alert variant="destructive" data-testid="alert-news-api-error">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{data.error || "Please enter a valid ticker symbol."}</AlertDescription>
        </Alert>
      )}

      {data?.ok && data.articles && !isFetching && (
        <div className="space-y-3" data-testid="container-news-results">
          <p className="text-sm text-muted-foreground" data-testid="text-news-results-summary">
            Showing {data.articles.length} recent headlines for <span className="font-medium">{data.ticker}</span>
          </p>

          {data.articles.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-news-no-results">
              <p>No recent headlines found for {data.ticker}.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.articles.map((article, index) => (
                <a
                  key={index}
                  href={article.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block group"
                  data-testid={`link-news-article-${index}`}
                >
                  <Card className="hover-elevate transition-colors">
                    <CardContent className="p-3">
                      <div className="flex gap-3">
                        {article.imageUrl && (
                          <div className="flex-shrink-0 hidden sm:block">
                            <img
                              src={article.imageUrl}
                              alt=""
                              className="h-14 w-20 object-cover rounded"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-sm line-clamp-2 group-hover:underline" data-testid={`text-news-article-title-${index}`}>
                            {article.title}
                          </h3>
                          <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground" data-testid={`text-news-article-meta-${index}`}>
                            <span>{article.source}</span>
                            <span>·</span>
                            <span>{formatDate(article.date)}</span>
                            <ExternalLink className="h-3 w-3 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      <Alert className="border-muted bg-muted/30" data-testid="alert-news-disclaimer">
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs text-muted-foreground">
          Headlines provided by Stock News API for informational purposes only. Not investment advice.
        </AlertDescription>
      </Alert>
    </div>
  );
}
