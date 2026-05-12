import { useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Grid3x3 } from "lucide-react";

/**
 * TradingView Stock Heatmap widget. The TradingView lightweight-charts
 * library is for charts only and does not include heatmaps, so this uses
 * TradingView's free embeddable Stock Heatmap widget instead. It loads
 * via their hosted script and renders a market-cap-weighted, sector-
 * grouped heatmap colored by daily performance.
 */
export function TradingViewHeatmap({
  height = 480,
  dataSource = "SPX500",
}: {
  height?: number;
  dataSource?: "SPX500" | "NASDAQ100" | "DJI" | "RUSSELL2000";
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";

    const inner = document.createElement("div");
    inner.className = "tradingview-widget-container__widget";
    inner.style.height = "100%";
    inner.style.width = "100%";
    container.appendChild(inner);

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-stock-heatmap.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      exchanges: [],
      dataSource,
      grouping: "sector",
      blockSize: "market_cap_basic",
      blockColor: "change",
      locale: "en",
      symbolUrl: "",
      colorTheme: "dark",
      hasTopBar: true,
      isDataSetEnabled: true,
      isZoomEnabled: true,
      hasSymbolTooltip: true,
      isMonoSize: false,
      width: "100%",
      height: "100%",
    });
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
    };
  }, [dataSource]);

  return (
    <Card data-testid="card-stock-heatmap" className="hover-elevate">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Grid3x3 className="h-4 w-4 text-primary" />
          Market Heatmap
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {dataSource === "SPX500"
            ? "S&P 500"
            : dataSource === "NASDAQ100"
              ? "Nasdaq 100"
              : dataSource === "DJI"
                ? "Dow 30"
                : "Russell 2000"}{" "}
          stocks grouped by sector, sized by market cap, colored by today's change. Powered by TradingView.
        </p>
      </CardHeader>
      <CardContent>
        <div
          ref={containerRef}
          className="tradingview-widget-container"
          style={{ height: `${height}px`, width: "100%" }}
          data-testid="container-heatmap"
        />
      </CardContent>
    </Card>
  );
}
