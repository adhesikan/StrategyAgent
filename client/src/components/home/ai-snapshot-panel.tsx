import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { TrendingUp, DollarSign, AlertTriangle, Activity, Sparkles } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface SnapshotItem {
  symbol: string;
  name?: string;
  headline: string;
}

interface HomeSnapshot {
  marketTone: "bullish" | "mixed" | "defensive";
  marketToneReason: string;
  bestIncome: SnapshotItem;
  topGrowth: SnapshotItem;
  watchlistAlert: { symbol: string; message: string } | null;
  asOf: string;
  disclaimer: string;
}

const TONE_STYLE: Record<string, string> = {
  bullish: "border-emerald-500/30 bg-emerald-500/5 text-emerald-400",
  mixed: "border-amber-500/30 bg-amber-500/5 text-amber-400",
  defensive: "border-rose-500/30 bg-rose-500/5 text-rose-400",
};

function SnapshotCard({
  icon: Icon,
  label,
  value,
  sub,
  testId,
  onClick,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  testId: string;
  onClick?: () => void;
  tone?: string;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "group text-left w-full rounded-xl border bg-card/40 backdrop-blur p-3 md:p-4 transition-all",
        onClick && "hover-elevate active-elevate-2 cursor-pointer",
        tone ?? "border-border/60",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background/40">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground leading-tight">{label}</p>
          <p className="text-sm md:text-base font-semibold leading-tight mt-0.5 truncate" data-testid={`${testId}-value`}>
            {value}
          </p>
          {sub && (
            <p className="text-xs text-muted-foreground leading-snug mt-1 line-clamp-2">{sub}</p>
          )}
        </div>
      </div>
    </Comp>
  );
}

export function AiSnapshotPanel() {
  const [, navigate] = useLocation();
  const { data, isLoading } = useQuery<HomeSnapshot>({
    queryKey: ["/api/home/snapshot"],
    staleTime: 5 * 60 * 1000,
  });

  return (
    <section className="space-y-3" data-testid="section-ai-snapshot">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Today's AI Snapshot
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
        {isLoading || !data ? (
          <>
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
          </>
        ) : (
          <>
            <SnapshotCard
              icon={Activity}
              label="Market Tone"
              value={data.marketTone.charAt(0).toUpperCase() + data.marketTone.slice(1)}
              sub={data.marketToneReason}
              testId="snapshot-market-tone"
              tone={TONE_STYLE[data.marketTone]}
              onClick={() => navigate("/market-intel")}
            />
            <SnapshotCard
              icon={DollarSign}
              label="Best Income Setup"
              value={data.bestIncome.name ? `${data.bestIncome.symbol} · ${data.bestIncome.name}` : data.bestIncome.symbol}
              sub={data.bestIncome.headline}
              testId="snapshot-best-income"
              onClick={() => navigate("/income-mode")}
            />
            <SnapshotCard
              icon={TrendingUp}
              label="Top Growth Opportunity"
              value={data.topGrowth.name ? `${data.topGrowth.symbol} · ${data.topGrowth.name}` : data.topGrowth.symbol}
              sub={data.topGrowth.headline}
              testId="snapshot-top-growth"
              onClick={() => navigate(`/market-intel?symbol=${encodeURIComponent(data.topGrowth.symbol)}`)}
            />
            <SnapshotCard
              icon={AlertTriangle}
              label="Watchlist Risk"
              value={data.watchlistAlert?.symbol ?? "All Clear"}
              sub={data.watchlistAlert?.message ?? "No flagged risks on your watchlist right now."}
              testId="snapshot-watchlist-alert"
              tone={data.watchlistAlert ? "border-rose-500/30 bg-rose-500/5" : undefined}
              onClick={
                data.watchlistAlert
                  ? () => navigate(`/market-intel?symbol=${encodeURIComponent(data.watchlistAlert!.symbol)}`)
                  : () => navigate("/market-intel")
              }
            />
          </>
        )}
      </div>
    </section>
  );
}
