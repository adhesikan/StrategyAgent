import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, RotateCw } from "lucide-react";
import { track } from "@/lib/analytics";
import {
  CONGRESSFLOW_ORIGIN,
  CONGRESSFLOW_INCOMING_TYPES,
  buildCongressFlowEmbedUrl,
  isValidIsoDate,
  isValidPoliticianSlug,
  normalizeTicker,
  normalizeWatchlist,
  type CongressFlowView,
} from "@/lib/congressflow";

const SLOW_LOAD_MS = 12000;
const ERROR_TIMEOUT_MS = 30000;

interface CongressFlowEmbedProps {
  view?: CongressFlowView;
  ticker?: string;
  politicianSlug?: string;
  watchlistTickers?: string[];
  startDate?: string;
  endDate?: string;
  minHeight?: number;
  maxHeight?: number;
  className?: string;
  onReady?: (version?: string) => void;
  onTickerSelected?: (ticker: string) => void;
  onPoliticianSelected?: (payload: { slug: string; name?: string }) => void;
  onSourceOpened?: (url: string) => void;
}

type EmbedStatus = "loading" | "slow" | "ready" | "error";

export function CongressFlowEmbed({
  view = "activity",
  ticker,
  politicianSlug,
  watchlistTickers,
  startDate,
  endDate,
  minHeight = 500,
  maxHeight = 2400,
  className,
  onReady,
  onTickerSelected,
  onPoliticianSelected,
  onSourceOpened,
}: CongressFlowEmbedProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  const lastSentTickerRef = useRef<string | null>(null);
  const lastSentDatesRef = useRef<string | null>(null);
  const lastSentWatchlistRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const loadStartRef = useRef<number>(Date.now());
  const [status, setStatus] = useState<EmbedStatus>("loading");
  const [reloadKey, setReloadKey] = useState(0);

  const fallbackHeight = view === "activity" ? 700 : 480;
  const src = buildCongressFlowEmbedUrl({ view, ticker, politicianSlug });

  const postToEmbed = useCallback((payload: Record<string, unknown>) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(payload, CONGRESSFLOW_ORIGIN);
  }, []);

  const syncCommands = useCallback(() => {
    if (!readyRef.current) return;
    const t = ticker ? normalizeTicker(ticker) : null;
    if (t && t !== lastSentTickerRef.current) {
      postToEmbed({ type: "SET_TICKER", ticker: t });
      lastSentTickerRef.current = t;
      track("congressflow_ticker_sent", { view, ticker: t });
    }
    if (startDate && endDate && isValidIsoDate(startDate) && isValidIsoDate(endDate) && startDate <= endDate) {
      const key = `${startDate}:${endDate}`;
      if (key !== lastSentDatesRef.current) {
        postToEmbed({ type: "SET_DATE_RANGE", startDate, endDate });
        lastSentDatesRef.current = key;
      }
    }
    if (watchlistTickers && watchlistTickers.length > 0) {
      const normalized = normalizeWatchlist(watchlistTickers);
      const key = normalized.join(",");
      if (normalized.length > 0 && key !== lastSentWatchlistRef.current) {
        postToEmbed({ type: "SET_WATCHLIST", tickers: normalized });
        lastSentWatchlistRef.current = key;
      }
    }
  }, [ticker, startDate, endDate, watchlistTickers, view, postToEmbed]);

  useEffect(() => {
    syncCommands();
  }, [syncCommands]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== CONGRESSFLOW_ORIGIN) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object" || typeof data.type !== "string") return;
      if (!CONGRESSFLOW_INCOMING_TYPES.has(data.type)) return;

      switch (data.type) {
        case "CONGRESSFLOW_READY": {
          readyRef.current = true;
          setStatus("ready");
          const version = typeof data.version === "string" ? data.version : undefined;
          track("congressflow_embed_ready", {
            view,
            version,
            ticker: ticker ?? undefined,
            route: window.location.pathname,
            loadDurationMs: Date.now() - loadStartRef.current,
          });
          syncCommands();
          onReady?.(version);
          break;
        }
        case "CONGRESSFLOW_HEIGHT_CHANGED": {
          const h = data.height;
          if (typeof h !== "number" || !Number.isFinite(h) || h <= 0 || h > 20000) return;
          const clamped = Math.min(Math.max(Math.round(h), minHeight), maxHeight);
          if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(() => {
            if (iframeRef.current) iframeRef.current.style.height = `${clamped}px`;
          });
          break;
        }
        case "CONGRESSFLOW_TICKER_SELECTED": {
          const t = typeof data.ticker === "string" ? normalizeTicker(data.ticker) : null;
          if (!t) return;
          track("congressflow_ticker_selected", { view, ticker: t, route: window.location.pathname });
          onTickerSelected?.(t);
          break;
        }
        case "CONGRESSFLOW_POLITICIAN_SELECTED": {
          const slug = typeof data.slug === "string" ? data.slug : "";
          if (!isValidPoliticianSlug(slug)) return;
          const name = typeof data.name === "string" ? data.name : undefined;
          track("congressflow_politician_selected", { view, politicianSlug: slug, route: window.location.pathname });
          onPoliticianSelected?.({ slug, name });
          break;
        }
        case "CONGRESSFLOW_SOURCE_OPENED": {
          const url = typeof data.url === "string" ? data.url : "";
          if (!url.startsWith("https://")) return;
          track("congressflow_source_opened", { view, route: window.location.pathname });
          onSourceOpened?.(url);
          break;
        }
      }
    }
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [view, ticker, minHeight, maxHeight, onReady, onTickerSelected, onPoliticianSelected, onSourceOpened, syncCommands]);

  useEffect(() => {
    readyRef.current = false;
    lastSentTickerRef.current = null;
    lastSentDatesRef.current = null;
    lastSentWatchlistRef.current = null;
    loadStartRef.current = Date.now();
    setStatus("loading");
    track("congressflow_embed_loaded", { view, ticker: ticker ?? undefined, route: window.location.pathname });
    const slowTimer = window.setTimeout(() => {
      setStatus((s) => (s === "loading" ? "slow" : s));
    }, SLOW_LOAD_MS);
    const errorTimer = window.setTimeout(() => {
      setStatus((s) => {
        if (s === "loading" || s === "slow") {
          track("congressflow_embed_error", { view, ticker: ticker ?? undefined, route: window.location.pathname });
          return "error";
        }
        return s;
      });
    }, ERROR_TIMEOUT_MS);
    return () => {
      window.clearTimeout(slowTimer);
      window.clearTimeout(errorTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, reloadKey]);

  const title =
    view === "ticker" && ticker
      ? `CongressFlow congressional activity for ${normalizeTicker(ticker) ?? ""}`
      : view === "politician"
        ? "CongressFlow profile for selected member"
        : "CongressFlow congressional financial disclosure activity";

  if (status === "error") {
    return (
      <div
        className={`rounded-lg border border-border bg-muted/30 p-8 flex flex-col items-center gap-3 text-center ${className ?? ""}`}
        role="alert"
        data-testid="congressflow-error-state"
      >
        <p className="text-sm text-muted-foreground">Congress Activity is temporarily unavailable.</p>
        <div className="flex flex-wrap gap-2 justify-center">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              track("congressflow_retry_clicked", { view, route: window.location.pathname });
              setReloadKey((k) => k + 1);
            }}
            data-testid="button-congressflow-retry"
          >
            <RotateCw className="h-4 w-4 mr-1.5" />
            Retry
          </Button>
          <Button size="sm" variant="outline" asChild data-testid="button-congressflow-open-external">
            <a href={src} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-1.5" />
              Open in a new tab
            </a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative w-full overflow-hidden ${className ?? ""}`}>
      {(status === "loading" || status === "slow") && (
        <div className="absolute inset-0 z-10 flex flex-col gap-3 p-4 bg-background" aria-live="polite" data-testid="congressflow-loading-state">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <p className="text-xs text-muted-foreground">
            {status === "slow" ? "CongressFlow is taking longer than expected to load." : "Loading Congress Activity…"}
          </p>
        </div>
      )}
      <iframe
        key={reloadKey}
        ref={iframeRef}
        src={src}
        title={title}
        width="100%"
        style={{ border: 0, height: `${fallbackHeight}px`, transition: "height 200ms ease" }}
        loading={view === "activity" ? "eager" : "lazy"}
        data-testid={`congressflow-iframe-${view}`}
      />
    </div>
  );
}
