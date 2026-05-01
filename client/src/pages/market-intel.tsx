import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Newspaper,
  Sparkles,
  Zap,
  Eye,
  TrendingUp,
  TrendingDown,
  Minus,
  ExternalLink,
  Search,
  AlertTriangle,
} from "lucide-react";
import { ComplianceFooter } from "@/components/trading-shell";

type SentimentLabel = "bullish" | "bearish" | "neutral" | "mixed";
type ImpactLevel = "low" | "medium" | "high";

interface AggregatedSnapshot {
  symbol: string;
  sentimentLabel: SentimentLabel;
  sentimentScore: number;
  confidence: number;
  impactLevel: ImpactLevel;
  buzzScore: number;
  articleCount: number;
  topThemes: string[];
  whyItMatters: string;
}

interface TrendingArticle {
  headline: string;
  summary: string;
  source: string | null;
  url: string | null;
  publishedAt: string | null;
  symbols: string[];
  sentimentLabel: SentimentLabel;
  sentimentScore: number;
  impactLevel: ImpactLevel;
  whyItMatters: string;
}

interface TrendingResponse {
  articles: TrendingArticle[];
  sources: { news: "live" | "mock"; sentiment: "openai" | "rule_based" };
  disclaimer: string;
}

interface WatchlistResponse {
  symbols: string[];
  snapshots: AggregatedSnapshot[];
  sources: { news: "live" | "mock"; sentiment: "openai" | "rule_based" };
  disclaimer: string;
}

interface SymbolSentimentArticle {
  id: string;
  headline: string;
  source: string | null;
  url: string | null;
  publishedAt: string | null;
  summary: string | null;
  whyItMatters: string | null;
  sentimentLabel: SentimentLabel | null;
  sentimentScore: number | null;
  impactLevel: ImpactLevel | null;
  bullishDrivers: string[];
  bearishDrivers: string[];
  riskWarnings: string[];
}

interface SymbolSentimentResponse {
  symbol: string;
  snapshot: AggregatedSnapshot | null;
  articles: SymbolSentimentArticle[];
  stale: boolean;
  sources: { news: "live" | "mock"; sentiment: "openai" | "rule_based" };
  disclaimer: string;
}

const LABEL_TONE: Record<SentimentLabel, string> = {
  bullish: "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
  bearish: "border-rose-500/40 text-rose-300 bg-rose-500/10",
  neutral: "border-zinc-500/30 text-zinc-300 bg-zinc-500/10",
  mixed: "border-amber-500/40 text-amber-300 bg-amber-500/10",
};

function LabelIcon({ label }: { label: SentimentLabel }) {
  if (label === "bullish") return <TrendingUp className="h-3.5 w-3.5" />;
  if (label === "bearish") return <TrendingDown className="h-3.5 w-3.5" />;
  return <Minus className="h-3.5 w-3.5" />;
}

function formatScore(n: number) {
  return `${n > 0 ? "+" : ""}${Math.round(n)}`;
}

function SourceBadge({ sources }: { sources?: { news: string; sentiment: string } }) {
  if (!sources) return null;
  return (
    <div className="text-[10px] text-muted-foreground flex items-center gap-1" data-testid="badge-sources">
      <Badge variant="outline" className="text-[10px]">news: {sources.news}</Badge>
      <Badge variant="outline" className="text-[10px]">sentiment: {sources.sentiment}</Badge>
    </div>
  );
}

export default function MarketIntelPage() {
  const trendingQuery = useQuery<TrendingResponse>({
    queryKey: ["/api/news/trending"],
  });
  const watchlistQuery = useQuery<WatchlistResponse>({
    queryKey: ["/api/sentiment/watchlist"],
  });

  const [whySymbol, setWhySymbol] = useState("");
  const [activeWhySymbol, setActiveWhySymbol] = useState<string | null>(null);
  const whyQuery = useQuery<SymbolSentimentResponse>({
    queryKey: ["/api/sentiment", activeWhySymbol],
    enabled: !!activeWhySymbol,
  });

  const sortedWatchlist = useMemo(() => {
    return (watchlistQuery.data?.snapshots ?? []).slice();
  }, [watchlistQuery.data]);

  const strongestPositive = useMemo(() => {
    return sortedWatchlist
      .filter((s) => s.articleCount > 0)
      .slice()
      .sort((a, b) => b.sentimentScore - a.sentimentScore)
      .slice(0, 5);
  }, [sortedWatchlist]);

  const strongestNegative = useMemo(() => {
    return sortedWatchlist
      .filter((s) => s.articleCount > 0)
      .slice()
      .sort((a, b) => a.sentimentScore - b.sentimentScore)
      .slice(0, 5);
  }, [sortedWatchlist]);

  const morningArticles = useMemo(() => {
    return (trendingQuery.data?.articles ?? [])
      .slice()
      .sort((a, b) => Math.abs(b.sentimentScore) - Math.abs(a.sentimentScore))
      .slice(0, 6);
  }, [trendingQuery.data]);

  const sources = trendingQuery.data?.sources ?? watchlistQuery.data?.sources;

  function submitWhy(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = whySymbol.trim().toUpperCase();
    if (trimmed.length === 0) return;
    setActiveWhySymbol(trimmed);
  }

  return (
    <div className="flex-1 p-4 md:p-6 max-w-6xl mx-auto w-full space-y-6">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Newspaper className="h-6 w-6 text-amber-400" />
            Market Intel
          </h1>
          <SourceBadge sources={sources} />
        </div>
        <p className="text-sm text-muted-foreground">
          AI-summarized news context, watchlist sentiment, and informational catalyst tracking.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MorningBriefing
          articles={morningArticles}
          isLoading={trendingQuery.isLoading}
        />
        <WatchlistSentiment
          snapshots={sortedWatchlist}
          symbols={watchlistQuery.data?.symbols ?? []}
          isLoading={watchlistQuery.isLoading}
        />
        <ExtremesCard
          title="Strongest Positive"
          icon={TrendingUp}
          tone="text-emerald-300"
          items={strongestPositive}
          isLoading={watchlistQuery.isLoading}
          emptyText="No bullish-leaning watchlist names right now."
          testId="card-strongest-positive"
        />
        <ExtremesCard
          title="Strongest Negative"
          icon={TrendingDown}
          tone="text-rose-300"
          items={strongestNegative}
          isLoading={watchlistQuery.isLoading}
          emptyText="No bearish-leaning watchlist names right now."
          testId="card-strongest-negative"
        />
      </div>

      <WhyIsItMovingCard
        symbol={whySymbol}
        onSymbolChange={setWhySymbol}
        onSubmit={submitWhy}
        activeSymbol={activeWhySymbol}
        result={whyQuery.data}
        isLoading={whyQuery.isLoading}
      />

      <ComplianceFooter />
    </div>
  );
}

function MorningBriefing({
  articles,
  isLoading,
}: {
  articles: TrendingArticle[];
  isLoading: boolean;
}) {
  return (
    <Card data-testid="card-morning-briefing" className="hover-elevate">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-400" />
          Morning Briefing
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Trending headlines ranked by absolute sentiment impact.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <Skeleton className="h-32 w-full" />}
        {!isLoading && articles.length === 0 && (
          <p className="text-xs text-muted-foreground" data-testid="text-empty-briefing">
            No trending headlines available.
          </p>
        )}
        {articles.map((a, i) => (
          <div
            key={`${a.headline}-${i}`}
            className={`rounded border p-2.5 space-y-1 ${LABEL_TONE[a.sentimentLabel]}`}
            data-testid={`article-briefing-${i}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-medium leading-snug" data-testid={`text-briefing-headline-${i}`}>
                {a.headline}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Badge variant="outline" className={`${LABEL_TONE[a.sentimentLabel]} text-[10px]`}>
                  <LabelIcon label={a.sentimentLabel} />
                  <span className="ml-1">{formatScore(a.sentimentScore)}</span>
                </Badge>
                {a.url && (
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs hover:underline flex items-center"
                    data-testid={`link-briefing-${i}`}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
            <div className="text-[11px] opacity-80">
              {a.source ?? "Unknown"}
              {a.symbols.length > 0 ? ` · ${a.symbols.slice(0, 4).join(", ")}` : ""}
              {a.publishedAt ? ` · ${new Date(a.publishedAt).toLocaleString()}` : ""}
            </div>
            <p className="text-xs opacity-90 leading-snug">{a.whyItMatters || a.summary}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function WatchlistSentiment({
  snapshots,
  symbols,
  isLoading,
}: {
  snapshots: AggregatedSnapshot[];
  symbols: string[];
  isLoading: boolean;
}) {
  return (
    <Card data-testid="card-watchlist-sentiment" className="hover-elevate">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" />
          Watchlist Sentiment
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Per-ticker rollups across {symbols.length} watchlist symbol{symbols.length === 1 ? "" : "s"}.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <Skeleton className="h-32 w-full" />}
        {!isLoading && snapshots.length === 0 && (
          <p className="text-xs text-muted-foreground" data-testid="text-empty-watchlist">
            Add symbols to your watchlist to see sentiment rollups here.
          </p>
        )}
        {snapshots.map((s) => (
          <SnapshotRow key={s.symbol} snapshot={s} />
        ))}
      </CardContent>
    </Card>
  );
}

function ExtremesCard({
  title,
  icon: Icon,
  tone,
  items,
  isLoading,
  emptyText,
  testId,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  items: AggregatedSnapshot[];
  isLoading: boolean;
  emptyText: string;
  testId: string;
}) {
  return (
    <Card data-testid={testId} className="hover-elevate">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Icon className={`h-4 w-4 ${tone}`} />
          {title}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          From your watchlist, ranked by aggregated sentiment.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <Skeleton className="h-24 w-full" />}
        {!isLoading && items.length === 0 && (
          <p className="text-xs text-muted-foreground">{emptyText}</p>
        )}
        {items.map((s) => (
          <SnapshotRow key={s.symbol} snapshot={s} compact />
        ))}
      </CardContent>
    </Card>
  );
}

function SnapshotRow({
  snapshot,
  compact,
}: {
  snapshot: AggregatedSnapshot;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded border p-2.5 space-y-1 ${LABEL_TONE[snapshot.sentimentLabel]}`}
      data-testid={`row-snapshot-${snapshot.symbol}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-bold" data-testid={`text-symbol-${snapshot.symbol}`}>
            {snapshot.symbol}
          </span>
          <Badge variant="outline" className={`${LABEL_TONE[snapshot.sentimentLabel]} text-[10px]`}>
            <LabelIcon label={snapshot.sentimentLabel} />
            <span className="ml-1 capitalize">{snapshot.sentimentLabel}</span>
            <span className="ml-1">{formatScore(snapshot.sentimentScore)}</span>
          </Badge>
        </div>
        <div className="text-[11px] opacity-80">
          {snapshot.articleCount} article{snapshot.articleCount === 1 ? "" : "s"} · impact {snapshot.impactLevel} · buzz {snapshot.buzzScore}
        </div>
      </div>
      {!compact && snapshot.whyItMatters && (
        <p className="text-xs opacity-90 leading-snug">{snapshot.whyItMatters}</p>
      )}
      {!compact && snapshot.topThemes.length > 0 && (
        <div className="text-[11px] opacity-80">
          <span className="font-semibold">Themes: </span>
          {snapshot.topThemes.slice(0, 4).join(" · ")}
        </div>
      )}
    </div>
  );
}

function WhyIsItMovingCard({
  symbol,
  onSymbolChange,
  onSubmit,
  activeSymbol,
  result,
  isLoading,
}: {
  symbol: string;
  onSymbolChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  activeSymbol: string | null;
  result?: SymbolSentimentResponse;
  isLoading: boolean;
}) {
  return (
    <Card data-testid="card-why-moving" className="hover-elevate">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-400" />
          Why Is It Moving?
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Pull the latest news context and AI sentiment summary for any ticker.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={onSubmit} className="flex items-center gap-2">
          <Input
            placeholder="Enter symbol (e.g. AAPL)"
            value={symbol}
            onChange={(e) => onSymbolChange(e.target.value.toUpperCase())}
            className="max-w-[200px]"
            data-testid="input-why-symbol"
          />
          <Button type="submit" size="sm" data-testid="button-why-search">
            <Search className="h-3.5 w-3.5 mr-1" />
            Look up
          </Button>
        </form>

        {activeSymbol && isLoading && <Skeleton className="h-32 w-full" />}

        {activeSymbol && !isLoading && result?.snapshot && (
          <div className={`rounded border p-3 space-y-2 ${LABEL_TONE[result.snapshot.sentimentLabel]}`}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <LabelIcon label={result.snapshot.sentimentLabel} />
                <span className="font-bold">{result.snapshot.symbol}</span>
                <Badge variant="outline" className={`${LABEL_TONE[result.snapshot.sentimentLabel]} text-[10px]`}>
                  {result.snapshot.sentimentLabel} {formatScore(result.snapshot.sentimentScore)}
                </Badge>
                <span className="text-[11px] opacity-80">
                  · {result.snapshot.articleCount} articles · impact {result.snapshot.impactLevel}
                </span>
              </div>
              {result.stale && (
                <Badge variant="outline" className="border-amber-500/40 text-amber-300 text-[10px]">
                  cached
                </Badge>
              )}
            </div>
            <p className="text-xs opacity-90" data-testid={`text-why-summary-${result.snapshot.symbol}`}>
              {result.snapshot.whyItMatters}
            </p>
            {result.snapshot.topThemes.length > 0 && (
              <div className="text-[11px] opacity-80">
                <span className="font-semibold">Themes: </span>
                {result.snapshot.topThemes.join(" · ")}
              </div>
            )}
          </div>
        )}

        {activeSymbol && !isLoading && result && result.articles.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs uppercase tracking-wide text-muted-foreground">
              Recent articles
            </h4>
            {result.articles.slice(0, 5).map((a) => (
              <div
                key={a.id}
                className="rounded border border-border p-2.5 space-y-1"
                data-testid={`article-why-${a.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-medium leading-snug">{a.headline}</div>
                  {a.url && (
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs hover:underline shrink-0"
                      data-testid={`link-why-${a.id}`}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {a.source ?? "Unknown"}
                  {a.publishedAt ? ` · ${new Date(a.publishedAt).toLocaleString()}` : ""}
                </div>
                {a.sentimentLabel && (
                  <Badge variant="outline" className={`${LABEL_TONE[a.sentimentLabel]} text-[10px]`}>
                    {a.sentimentLabel}
                    {a.sentimentScore != null ? ` ${formatScore(a.sentimentScore)}` : ""}
                  </Badge>
                )}
                {a.summary && <p className="text-xs leading-snug">{a.summary}</p>}
                {a.whyItMatters && (
                  <p className="text-xs italic text-muted-foreground">Why it matters: {a.whyItMatters}</p>
                )}
                {a.riskWarnings.length > 0 && (
                  <div className="text-[11px] text-amber-300">
                    <AlertTriangle className="h-3 w-3 inline mr-1" />
                    {a.riskWarnings.join(" · ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {activeSymbol && !isLoading && result && !result.snapshot && (
          <p className="text-xs text-muted-foreground" data-testid="text-no-results">
            No recent news context found for {activeSymbol}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
