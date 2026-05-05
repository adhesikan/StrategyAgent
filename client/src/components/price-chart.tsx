import { useEffect, useRef, useState, useCallback } from "react";
import { createChart, type IChartApi, ColorType, LineStyle, CandlestickSeries, HistogramSeries, LineSeries, AreaSeries } from "lightweight-charts";
import { useTheme } from "@/lib/theme-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { TrendingUp, TrendingDown, Activity, BarChart3, Layers, Target, AlertTriangle } from "lucide-react";
import { InfoTooltip } from "@/components/info-tooltip";

interface CandleData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface VCPAnnotation {
  time: string;
  price: number;
  type: "pivot_high" | "pivot_low" | "contraction_start" | "breakout";
  label?: string;
}

interface PriceChartProps {
  data: CandleData[];
  ema9?: number[];
  ema21?: number[];
  ema50?: number[];
  resistanceLevel?: number;
  stopLevel?: number;
  ticker?: string;
  className?: string;
  showVCPOverlay?: boolean;
  showVolume?: boolean;
  vcpAnnotations?: VCPAnnotation[];
  atr?: number;
  contractionZones?: Array<{ start: string; end: string; highLevel: number; lowLevel: number }>;
}

interface ChartTooltipData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  changePercent: number;
}

export function PriceChart({
  data,
  ema9,
  ema21,
  ema50,
  resistanceLevel,
  stopLevel,
  ticker,
  className,
  showVCPOverlay = true,
  showVolume = true,
  vcpAnnotations,
  atr,
  contractionZones,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const { resolvedTheme: theme } = useTheme();
  const [tooltipData, setTooltipData] = useState<ChartTooltipData | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const isDark = theme === "dark";

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: isDark ? "#a1a1aa" : "#71717a",
        fontFamily: "'Roboto Mono', monospace",
      },
      grid: {
        vertLines: { color: isDark ? "#27272a" : "#e4e4e7", style: LineStyle.Dotted },
        horzLines: { color: isDark ? "#27272a" : "#e4e4e7", style: LineStyle.Dotted },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: isDark ? "#52525b" : "#a1a1aa",
          style: LineStyle.Dashed,
          width: 1,
          labelBackgroundColor: isDark ? "#3f3f46" : "#e4e4e7",
        },
        horzLine: {
          color: isDark ? "#52525b" : "#a1a1aa",
          style: LineStyle.Dashed,
          width: 1,
          labelBackgroundColor: isDark ? "#3f3f46" : "#e4e4e7",
        },
      },
      rightPriceScale: {
        borderColor: isDark ? "#27272a" : "#e4e4e7",
        scaleMargins: { top: 0.08, bottom: 0.22 },
        autoScale: true,
      },
      timeScale: {
        borderColor: isDark ? "#27272a" : "#e4e4e7",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
        minBarSpacing: 4,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
    });

    chartRef.current = chart;

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    let volumeSeries: any = null;
    const hasVolumeData = showVolume && data.some(d => d.volume && d.volume > 0);
    if (hasVolumeData) {
      volumeSeries = chart.addSeries(HistogramSeries, {
        color: isDark ? "#3b82f680" : "#3b82f660",
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
      });
      chart.priceScale("volume").applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
      });
    }

    if (data.length > 0) {
      const candleData = data.map(d => ({
        time: d.time,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }));
      candlestickSeries.setData(candleData as any);

      if (volumeSeries) {
        const volumeData = data.map(d => ({
          time: d.time,
          value: d.volume || 0,
          color: d.close >= d.open
            ? (isDark ? "#22c55e50" : "#22c55e30")
            : (isDark ? "#ef444450" : "#ef444430"),
        }));
        volumeSeries.setData(volumeData as any);
      }
    }

    if (ema9 && ema9.length > 0 && data.length > 0) {
      const ema9Series = chart.addSeries(LineSeries, {
        color: "#f59e0b",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        title: "EMA9",
      });
      const ema9Data = ema9.map((value, i) => ({
        time: data[i]?.time,
        value,
      })).filter(d => d.time && d.value);
      ema9Series.setData(ema9Data as any);
    }

    if (ema21 && ema21.length > 0 && data.length > 0) {
      const ema21Series = chart.addSeries(LineSeries, {
        color: "#3b82f6",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        title: "EMA21",
      });
      const ema21Data = ema21.map((value, i) => ({
        time: data[i]?.time,
        value,
      })).filter(d => d.time && d.value);
      ema21Series.setData(ema21Data as any);
    }

    if (ema50 && ema50.length > 0 && data.length > 0) {
      const ema50Series = chart.addSeries(LineSeries, {
        color: "#8b5cf6",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        title: "EMA50",
      });
      const ema50Data = ema50.map((value, i) => ({
        time: data[i]?.time,
        value,
      })).filter(d => d.time && d.value);
      ema50Series.setData(ema50Data as any);
    }

    if (resistanceLevel && data.length > 0) {
      const resistanceLine = chart.addSeries(LineSeries, {
        color: "#22c55e",
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: true,
        title: "Resistance",
      });
      resistanceLine.setData([
        { time: data[0].time, value: resistanceLevel },
        { time: data[data.length - 1].time, value: resistanceLevel },
      ] as any);

      candlestickSeries.createPriceLine({
        price: resistanceLevel,
        color: "#22c55e",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "R",
      });
    }

    if (stopLevel && data.length > 0) {
      const stopLine = chart.addSeries(LineSeries, {
        color: "#ef4444",
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: true,
        title: "Stop",
      });
      stopLine.setData([
        { time: data[0].time, value: stopLevel },
        { time: data[data.length - 1].time, value: stopLevel },
      ] as any);

      candlestickSeries.createPriceLine({
        price: stopLevel,
        color: "#ef4444",
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: "S",
      });
    }

    if (showVCPOverlay && contractionZones && contractionZones.length > 0) {
      contractionZones.forEach((zone, idx) => {
        const zoneSeries = chart.addSeries(AreaSeries, {
          topColor: isDark ? "rgba(59, 130, 246, 0.15)" : "rgba(59, 130, 246, 0.1)",
          bottomColor: isDark ? "rgba(59, 130, 246, 0.02)" : "rgba(59, 130, 246, 0.01)",
          lineColor: isDark ? "rgba(59, 130, 246, 0.4)" : "rgba(59, 130, 246, 0.3)",
          lineWidth: 1,
          priceScaleId: "right",
          lastValueVisible: false,
          priceLineVisible: false,
        });
        
        const zoneData = data
          .filter(d => d.time >= zone.start && d.time <= zone.end)
          .map(d => ({
            time: d.time,
            value: zone.highLevel,
          }));
        if (zoneData.length > 0) {
          zoneSeries.setData(zoneData as any);
        }
      });
    }

    if (showVCPOverlay && vcpAnnotations && vcpAnnotations.length > 0) {
      const pivotHighs = vcpAnnotations.filter(a => a.type === "pivot_high");
      const pivotLows = vcpAnnotations.filter(a => a.type === "pivot_low");

      pivotHighs.forEach(ph => {
        candlestickSeries.createPriceLine({
          price: ph.price,
          color: "rgba(34, 197, 94, 0.5)",
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: false,
        });
      });

      pivotLows.forEach(pl => {
        candlestickSeries.createPriceLine({
          price: pl.price,
          color: "rgba(239, 68, 68, 0.5)",
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: false,
        });
      });
    }

    chart.subscribeCrosshairMove((param) => {
      if (param.time && param.seriesData.size > 0) {
        const candleInfo = param.seriesData.get(candlestickSeries) as any;
        if (candleInfo) {
          const prevCandle = data.find((d, i) => {
            const nextD = data[i + 1];
            return nextD && nextD.time === param.time;
          });
          const change = prevCandle ? candleInfo.close - prevCandle.close : 0;
          const changePercent = prevCandle ? (change / prevCandle.close) * 100 : 0;
          
          setTooltipData({
            time: param.time as string,
            open: candleInfo.open,
            high: candleInfo.high,
            low: candleInfo.low,
            close: candleInfo.close,
            volume: data.find(d => d.time === param.time)?.volume || 0,
            change,
            changePercent,
          });
        }
      } else {
        setTooltipData(null);
      }
    });

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [data, ema9, ema21, ema50, resistanceLevel, stopLevel, theme, showVCPOverlay, showVolume, vcpAnnotations, contractionZones]);

  const formatVolume = (vol: number) => {
    if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(2)}M`;
    if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
    return vol.toFixed(0);
  };

  return (
    <div className="relative">
      {tooltipData && (
        <div className="absolute top-2 left-2 z-10 bg-card/95 backdrop-blur-sm border rounded-md p-2 shadow-lg text-xs font-mono" data-testid="chart-tooltip">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-muted-foreground">{tooltipData.time}</span>
            <span>O: <span className="text-foreground">{tooltipData.open.toFixed(2)}</span></span>
            <span>H: <span className="text-chart-2">{tooltipData.high.toFixed(2)}</span></span>
            <span>L: <span className="text-destructive">{tooltipData.low.toFixed(2)}</span></span>
            <span>C: <span className={tooltipData.change >= 0 ? "text-chart-2" : "text-destructive"}>
              {tooltipData.close.toFixed(2)}
            </span></span>
            <span className={tooltipData.change >= 0 ? "text-chart-2" : "text-destructive"}>
              {tooltipData.change >= 0 ? "+" : ""}{tooltipData.changePercent.toFixed(2)}%
            </span>
            <span className="text-muted-foreground">Vol: {formatVolume(tooltipData.volume)}</span>
          </div>
        </div>
      )}
      
      <div 
        ref={containerRef} 
        className={`w-full min-h-[400px] ${className || ""}`}
        data-testid="price-chart"
      />

      <div className="absolute bottom-2 right-2 z-10 flex items-center gap-2 bg-card/90 backdrop-blur-sm border rounded-md p-1.5 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 bg-amber-500" />
          <span className="text-muted-foreground">EMA9</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 bg-blue-500" />
          <span className="text-muted-foreground">EMA21</span>
        </div>
        {ema50 && (
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 bg-violet-500" />
            <span className="text-muted-foreground">EMA50</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function ChartPlaceholder() {
  return (
    <div className="flex items-center justify-center min-h-[400px] rounded-md border border-dashed bg-muted/20">
      <div className="text-center">
        <BarChart3 className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
        <p className="text-muted-foreground">Select a symbol to view chart</p>
        <p className="text-xs text-muted-foreground/70 mt-1">Enter a ticker above or click from the scanner</p>
      </div>
    </div>
  );
}

interface TechnicalAnalysisWidgetProps {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  ema9?: number;
  ema21?: number;
  ema50?: number;
  resistance?: number;
  stopLoss?: number;
  atr?: number;
  rvol?: number;
  patternScore?: number;
  stage?: string;
  volume?: number;
  avgVolume?: number;
}

export function TechnicalAnalysisWidget({
  ticker,
  price,
  change,
  changePercent,
  ema9,
  ema21,
  ema50,
  resistance,
  stopLoss,
  atr,
  rvol,
  patternScore,
  stage,
  volume,
  avgVolume,
}: TechnicalAnalysisWidgetProps) {
  const isPositive = changePercent >= 0;
  const trendStrength = ema9 && ema21 ? (ema9 > ema21 ? "bullish" : ema9 < ema21 ? "bearish" : "neutral") : "neutral";
  const priceVsEma9 = ema9 ? ((price - ema9) / ema9) * 100 : 0;
  const distanceToResistance = resistance ? ((resistance - price) / price) * 100 : 0;
  const riskRewardRatio = resistance && stopLoss && price < resistance && price > stopLoss 
    ? ((resistance - price) / (price - stopLoss)).toFixed(2) 
    : "-";

  return (
    <Card data-testid="technical-analysis-widget">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Technical Analysis
          </div>
          {stage && (
            <Badge 
              variant={stage === "BREAKOUT" ? "default" : stage === "READY" ? "secondary" : "outline"}
              className="text-xs"
            >
              {stage}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">Trend <InfoTooltip term="trend" /></p>
            <div className="flex items-center gap-1.5">
              {trendStrength === "bullish" ? (
                <TrendingUp className="h-4 w-4 text-chart-2" />
              ) : trendStrength === "bearish" ? (
                <TrendingDown className="h-4 w-4 text-destructive" />
              ) : (
                <Activity className="h-4 w-4 text-muted-foreground" />
              )}
              <span className={`text-sm font-medium capitalize ${
                trendStrength === "bullish" ? "text-chart-2" : 
                trendStrength === "bearish" ? "text-destructive" : "text-muted-foreground"
              }`}>
                {trendStrength}
              </span>
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">vs EMA9</p>
            <span className={`text-sm font-mono font-medium ${priceVsEma9 >= 0 ? "text-chart-2" : "text-destructive"}`}>
              {priceVsEma9 >= 0 ? "+" : ""}{priceVsEma9.toFixed(2)}%
            </span>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium">Moving Averages</p>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="flex flex-col">
              <span className="text-muted-foreground flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                EMA9 <InfoTooltip term="ema9" />
              </span>
              <span className="font-mono">${ema9?.toFixed(2) || "-"}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-muted-foreground flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                EMA21 <InfoTooltip term="ema21" />
              </span>
              <span className="font-mono">${ema21?.toFixed(2) || "-"}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-muted-foreground flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-violet-500" />
                EMA50 <InfoTooltip term="ema50" />
              </span>
              <span className="font-mono">${ema50?.toFixed(2) || "-"}</span>
            </div>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium">VCP Levels</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Target className="h-3.5 w-3.5 text-chart-2" />
                <span className="text-xs text-muted-foreground">Resistance</span>
                <InfoTooltip term="resistance" />
              </div>
              <span className="text-sm font-mono text-chart-2">${resistance?.toFixed(2) || "-"}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                <span className="text-xs text-muted-foreground">Stop</span>
                <InfoTooltip term="stopLoss" />
              </div>
              <span className="text-sm font-mono text-destructive">${stopLoss?.toFixed(2) || "-"}</span>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">To Breakout</span>
            <span className={`font-mono ${distanceToResistance > 0 ? "text-chart-2" : "text-destructive"}`}>
              {distanceToResistance > 0 ? "+" : ""}{distanceToResistance.toFixed(2)}%
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1">R/R Ratio <InfoTooltip term="rrRatio" /></span>
            <span className="font-mono font-medium">{riskRewardRatio}:1</span>
          </div>
        </div>

        <Separator />

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-muted-foreground mb-1 flex items-center gap-1">ATR <InfoTooltip term="atr" /></p>
            <span className="font-mono">${atr?.toFixed(2) || "-"}</span>
          </div>
          <div>
            <p className="text-muted-foreground mb-1 flex items-center gap-1">RVOL <InfoTooltip term="rvol" /></p>
            <span className={`font-mono ${(rvol || 0) >= 1.5 ? "text-chart-2 font-medium" : ""}`}>
              {rvol?.toFixed(2) || "-"}x
            </span>
          </div>
          <div>
            <p className="text-muted-foreground mb-1 flex items-center gap-1">Volume <InfoTooltip term="volume" /></p>
            <span className="font-mono">
              {volume ? (volume >= 1_000_000 ? `${(volume / 1_000_000).toFixed(2)}M` : `${(volume / 1_000).toFixed(0)}K`) : "-"}
            </span>
          </div>
          <div>
            <p className="text-muted-foreground mb-1 flex items-center gap-1">Avg Volume <InfoTooltip term="avgVolume" /></p>
            <span className="font-mono text-muted-foreground">
              {avgVolume ? (avgVolume >= 1_000_000 ? `${(avgVolume / 1_000_000).toFixed(2)}M` : `${(avgVolume / 1_000).toFixed(0)}K`) : "-"}
            </span>
          </div>
        </div>

        {patternScore !== undefined && (
          <>
            <Separator />
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-muted-foreground flex items-center gap-1">VCP Pattern Score <InfoTooltip term="vcpScore" /></p>
                <span className="text-sm font-mono font-semibold">{patternScore}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    patternScore >= 80 ? "bg-chart-2" :
                    patternScore >= 60 ? "bg-amber-500" : "bg-muted-foreground"
                  }`}
                  style={{ width: `${Math.min(100, patternScore)}%` }}
                />
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface VolumeProfileWidgetProps {
  data: CandleData[];
  levels?: number;
}

export function VolumeProfileWidget({ data, levels = 10 }: VolumeProfileWidgetProps) {
  if (data.length === 0) return null;

  const minPrice = Math.min(...data.map(d => d.low));
  const maxPrice = Math.max(...data.map(d => d.high));
  const priceRange = maxPrice - minPrice;
  const levelHeight = priceRange / levels;

  const volumeByLevel: { price: number; volume: number; buyVolume: number }[] = [];
  
  for (let i = 0; i < levels; i++) {
    const levelLow = minPrice + (i * levelHeight);
    const levelHigh = levelLow + levelHeight;
    const levelMid = (levelLow + levelHigh) / 2;
    
    let totalVolume = 0;
    let buyVolume = 0;
    
    data.forEach(candle => {
      if (candle.high >= levelLow && candle.low <= levelHigh) {
        const overlap = Math.min(candle.high, levelHigh) - Math.max(candle.low, levelLow);
        const candleRange = candle.high - candle.low || 1;
        const proportion = overlap / candleRange;
        const vol = (candle.volume || 0) * proportion;
        totalVolume += vol;
        if (candle.close >= candle.open) {
          buyVolume += vol;
        }
      }
    });
    
    volumeByLevel.push({
      price: levelMid,
      volume: totalVolume,
      buyVolume,
    });
  }

  const maxVolume = Math.max(...volumeByLevel.map(l => l.volume));
  const pocLevel = volumeByLevel.reduce((max, l) => l.volume > max.volume ? l : max, volumeByLevel[0]);

  return (
    <Card data-testid="volume-profile-widget">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="h-4 w-4" />
          Volume Profile
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {volumeByLevel.reverse().map((level, idx) => {
            const width = maxVolume > 0 ? (level.volume / maxVolume) * 100 : 0;
            const buyRatio = level.volume > 0 ? (level.buyVolume / level.volume) * 100 : 50;
            const isPOC = level.price === pocLevel.price;
            
            return (
              <div key={idx} className="flex items-center gap-2 text-xs">
                <span className={`w-14 text-right font-mono ${isPOC ? "font-semibold" : "text-muted-foreground"}`}>
                  ${level.price.toFixed(0)}
                </span>
                <div className="flex-1 h-3 bg-muted rounded-sm overflow-hidden relative">
                  <div 
                    className="absolute left-0 top-0 h-full bg-chart-2/60"
                    style={{ width: `${(width * buyRatio) / 100}%` }}
                  />
                  <div 
                    className="absolute top-0 h-full bg-destructive/60"
                    style={{ 
                      left: `${(width * buyRatio) / 100}%`,
                      width: `${(width * (100 - buyRatio)) / 100}%` 
                    }}
                  />
                  {isPOC && (
                    <div className="absolute right-1 top-0 h-full flex items-center">
                      <span className="text-[10px] font-medium text-foreground">POC</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-center gap-4 mt-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <div className="w-3 h-2 bg-chart-2/60 rounded-sm" />
            <span>Buy</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-2 bg-destructive/60 rounded-sm" />
            <span>Sell</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface ChartControlsWidgetProps {
  showEMA9: boolean;
  setShowEMA9: (v: boolean) => void;
  showEMA21: boolean;
  setShowEMA21: (v: boolean) => void;
  showEMA50: boolean;
  setShowEMA50: (v: boolean) => void;
  showVolume: boolean;
  setShowVolume: (v: boolean) => void;
  showLevels: boolean;
  setShowLevels: (v: boolean) => void;
  showVCPOverlay: boolean;
  setShowVCPOverlay: (v: boolean) => void;
}

export function ChartControlsWidget({
  showEMA9,
  setShowEMA9,
  showEMA21,
  setShowEMA21,
  showEMA50,
  setShowEMA50,
  showVolume,
  setShowVolume,
  showLevels,
  setShowLevels,
  showVCPOverlay,
  setShowVCPOverlay,
}: ChartControlsWidgetProps) {
  return (
    <Card data-testid="chart-controls-widget">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="h-4 w-4" />
          Chart Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="ema9" className="text-sm flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            EMA 9
          </Label>
          <Switch id="ema9" checked={showEMA9} onCheckedChange={setShowEMA9} />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="ema21" className="text-sm flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            EMA 21
          </Label>
          <Switch id="ema21" checked={showEMA21} onCheckedChange={setShowEMA21} />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="ema50" className="text-sm flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-violet-500" />
            EMA 50
          </Label>
          <Switch id="ema50" checked={showEMA50} onCheckedChange={setShowEMA50} />
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <Label htmlFor="volume" className="text-sm">Volume Bars</Label>
          <Switch id="volume" checked={showVolume} onCheckedChange={setShowVolume} />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="levels" className="text-sm">R/S Levels</Label>
          <Switch id="levels" checked={showLevels} onCheckedChange={setShowLevels} />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="vcp" className="text-sm">VCP Overlays</Label>
          <Switch id="vcp" checked={showVCPOverlay} onCheckedChange={setShowVCPOverlay} />
        </div>
      </CardContent>
    </Card>
  );
}
