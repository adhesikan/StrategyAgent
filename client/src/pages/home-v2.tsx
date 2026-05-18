import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Settings2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  ArrowRight,
  DollarSign,
  Newspaper,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Activity,
  AlertTriangle,
  Info,
} from "lucide-react";
import { DailyIdeaCard, DailyIdeaRow, SimpleIdeaCard, GRADE_WEIGHTS, type DailyIdea } from "@/components/daily-idea-card";
import { ViewToggle, type ViewMode } from "@/components/view-toggle";
import { HelpLink } from "@/components/help-link";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface IndexQuote { symbol: string; name: string; last: number; changePercent: number; }
interface MoverQuote { symbol: string; last: number; changePercent: number; }
interface NewsItem {
  symbol: string;
  label: "bullish" | "bearish" | "neutral";
  impact: "high" | "medium" | "low";
  buzz: number;
  whyItMatters: string;
  articleCount: number;
}

interface Snapshot {
  marketTone: "bullish" | "mixed" | "defensive";
  marketToneReason: string;
  indices: IndexQuote[];
  topMovers: MoverQuote[];
  topNews: NewsItem[];
  bestIncome: { symbol: string; name?: string; headline: string } | null;
  topGrowth: { symbol: string; name?: string; headline: string } | null;
  watchlistAlert: { symbol: string; message: string } | null;
  dataMode: "live" | "simulated";
  asOf: string;
  disclaimer: string;
}

function InfoHint({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="text-muted-foreground/70 hover:text-foreground" aria-label="What does this mean?">
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

const TONE_CLASS: Record<string, string> = {
  bullish: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  mixed: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  defensive: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

interface DailyMarketRegime {
  label: string;
  tone: "bullish" | "bearish" | "mixed" | "low_vol" | "high_vol";
  hint: string;
}

interface IdeasResponse {
  ideas: DailyIdea[];
  brokerConnected: boolean;
  dataMode: "live" | "simulated" | "mixed";
  marketRegime?: DailyMarketRegime;
  asOf: string;
  disclaimer: string;
}

const REGIME_TONE: Record<DailyMarketRegime["tone"], string> = {
  bullish: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  bearish: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
  mixed: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  low_vol: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
  high_vol: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30",
};

type ScanUniverseId =
  | "default"
  | "watchlist"
  | "large_cap"
  | "nasdaq_100"
  | "sp_500"
  | "high_volume"
  | "options_liquid"
  | "custom";

const SCAN_UNIVERSE_OPTIONS: { value: ScanUniverseId; label: string; hint: string }[] = [
  { value: "default", label: "Auto (recommended)", hint: "Use your watchlist with smart fallbacks" },
  { value: "watchlist", label: "My Watchlist", hint: "Only the symbols you've saved" },
  { value: "large_cap", label: "Dow 30", hint: "30 blue-chip stocks" },
  { value: "nasdaq_100", label: "Nasdaq 100", hint: "Top 100 Nasdaq names" },
  { value: "sp_500", label: "S&P 500", hint: "Top 500 US stocks (sampled)" },
  { value: "high_volume", label: "High Volume", hint: "Most-traded liquid names" },
  { value: "options_liquid", label: "Options Liquid", hint: "Best for option ideas" },
  { value: "custom", label: "Custom symbols…", hint: "Enter your own list" },
];

interface ScanPrefs {
  universe: ScanUniverseId;
  customSymbols: string;
}

function decodeScanPrefs(raw: string | null | undefined): ScanPrefs {
  if (!raw || raw === "all") return { universe: "default", customSymbols: "" };
  if (raw.startsWith("custom:")) {
    return { universe: "custom", customSymbols: raw.slice("custom:".length) };
  }
  const valid = SCAN_UNIVERSE_OPTIONS.map((o) => o.value);
  if (valid.includes(raw as ScanUniverseId)) {
    return { universe: raw as ScanUniverseId, customSymbols: "" };
  }
  return { universe: "default", customSymbols: "" };
}

function encodeScanPrefs(p: ScanPrefs): string {
  if (p.universe === "default") return "all";
  if (p.universe === "custom") {
    const list = p.customSymbols
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 30)
      .join(",");
    return list ? `custom:${list}` : "all";
  }
  return p.universe;
}

function buildIdeasUrl(bucket: string, p: ScanPrefs): string {
  const params = new URLSearchParams({ bucket });
  if (p.universe === "custom") {
    const list = p.customSymbols
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 30);
    if (list.length > 0) params.set("customSymbols", list.join(","));
  } else if (p.universe !== "default") {
    params.set("universe", p.universe);
  }
  return `/api/daily-ideas?${params.toString()}`;
}

const ACTIONS = [
  {
    title: "Grow My Money",
    desc: "Simple stock and options ideas based on your limits",
    icon: TrendingUp,
    href: "/goal-mode",
    color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
    testId: "card-action-grow",
  },
  {
    title: "Generate Income",
    desc: "Covered calls, cash-secured puts, and income opportunities",
    icon: DollarSign,
    href: "/income-mode",
    color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
    testId: "card-action-income",
  },
  {
    title: "Find a Trade",
    desc: "Describe a stock or options setup in plain English",
    icon: Search,
    href: "/trade-finder",
    color: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300",
    testId: "card-action-trade",
  },
  {
    title: "Understand Markets",
    desc: "News, sentiment, catalysts, and watchlist impact",
    icon: Newspaper,
    href: "/market-intel",
    color: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300",
    testId: "card-action-markets",
  },
];

const PLACEHOLDERS = [
  "How can I grow $10k?",
  "Find income ideas under $200 risk",
  "Show bullish stock setups today",
  "Find defined-risk option ideas",
  "Why is NVDA moving?",
  "Show lower-risk swing trades",
];

// Simplified taxonomy: previous Grow/Stocks both queried the "stocks"
// bucket and Income/Options overlapped (income strategies are
// option-based). Collapsed to four meaningful tabs so users see
// distinct results, not duplicates.
type SortKey = "grade" | "score" | "risk_low" | "risk_high" | "symbol";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "grade", label: "Best Setup Match" },
  { value: "risk_low", label: "Lowest cost" },
  { value: "risk_high", label: "Highest cost" },
  { value: "symbol", label: "Symbol A→Z" },
];

// Higher = better. A+ > A > B > C > anything else.
const GRADE_RANK: Record<string, number> = { "A+": 4, A: 3, B: 2, C: 1 };

type InstrumentFilter = "all" | "stock" | "long_options" | "defined_risk";

const INSTRUMENT_FILTERS: { value: InstrumentFilter; label: string; hint: string }[] = [
  { value: "all", label: "All", hint: "Stocks plus every options structure." },
  { value: "stock", label: "Stocks", hint: "Long-share swing setups (no options)." },
  { value: "long_options", label: "Long Calls/Puts", hint: "Long calls and long puts — single-leg, premium-paid, defined-risk-by-premium." },
  { value: "defined_risk", label: "Spreads", hint: "Vertical spreads, covered calls, and cash-secured puts — every position has a known max loss." },
];

function matchesInstrumentFilter(t: DailyIdea["instrumentType"], f: InstrumentFilter): boolean {
  switch (f) {
    case "all":
      return true;
    case "stock":
      return t === "stock";
    case "long_options":
      return t === "long_call" || t === "long_put";
    case "defined_risk":
      return t === "spread" || t === "covered_call" || t === "cash_secured_put";
  }
}

function sortIdeas<T extends { grade: string; score: number; maxRisk: number; symbol: string }>(
  ideas: T[],
  key: SortKey,
): T[] {
  const arr = ideas.slice();
  arr.sort((a, b) => {
    switch (key) {
      case "grade": {
        const diff = (GRADE_RANK[b.grade] ?? 0) - (GRADE_RANK[a.grade] ?? 0);
        return diff !== 0 ? diff : b.score - a.score;
      }
      case "score":
        return b.score - a.score;
      case "risk_low":
        return a.maxRisk - b.maxRisk;
      case "risk_high":
        return b.maxRisk - a.maxRisk;
      case "symbol":
        return a.symbol.localeCompare(b.symbol);
    }
  });
  return arr;
}

const TABS: { value: string; label: string; bucket: string; hint: string }[] = [
  { value: "all", label: "All", bucket: "all", hint: "Top ideas across stocks and options" },
  { value: "stocks", label: "Stocks", bucket: "stocks", hint: "Stock swing setups (growth and trend)" },
  { value: "options", label: "Options", bucket: "options", hint: "Defined-risk options — directional and income" },
  { value: "watchlist", label: "Watchlist", bucket: "watchlist", hint: "Ideas only on your watchlist symbols" },
  { value: "alerts", label: "Market Alerts", bucket: "alerts", hint: "Heads-up notices on market events" },
];

function routeFor(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return "/ask";
  return `/ask?q=${encodeURIComponent(trimmed)}`;
}

export default function HomeV2() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("all");
  const [ideasView, setIdeasView] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "card";
    const v = window.localStorage.getItem("home.ideasView");
    return v === "list" || v === "card" ? v : "card";
  });
  const [cardMode, setCardMode] = useState<"simple" | "advanced">(() => {
    if (typeof window === "undefined") return "simple";
    const v = window.localStorage.getItem("home.cardMode");
    return v === "advanced" || v === "simple" ? v : "simple";
  });
  useEffect(() => {
    window.localStorage.setItem("home.cardMode", cardMode);
  }, [cardMode]);
  const [sortBy, setSortBy] = useState<SortKey>("grade");
  const [instrumentFilter, setInstrumentFilter] = useState<InstrumentFilter>(() => {
    if (typeof window === "undefined") return "all";
    const v = window.localStorage.getItem("home.instrumentFilter");
    return v === "all" || v === "stock" || v === "long_options" || v === "defined_risk" ? v : "all";
  });
  useEffect(() => {
    window.localStorage.setItem("home.ideasView", ideasView);
  }, [ideasView]);
  useEffect(() => {
    window.localStorage.setItem("home.instrumentFilter", instrumentFilter);
  }, [instrumentFilter]);
  const { toast } = useToast();
  const [scanPrefs, setScanPrefs] = useState<ScanPrefs>({ universe: "default", customSymbols: "" });
  const [customDraft, setCustomDraft] = useState("");

  const { data: snap } = useQuery<Snapshot>({
    queryKey: ["/api/home/snapshot"],
    refetchInterval: 60_000,
  });

  const { data: settingsData } = useQuery<{ scanUniverse?: string | null }>({
    queryKey: ["/api/user/settings"],
  });

  useEffect(() => {
    if (!settingsData) return;
    const decoded = decodeScanPrefs(settingsData.scanUniverse);
    setScanPrefs(decoded);
    setCustomDraft(decoded.customSymbols);
  }, [settingsData]);

  const saveScanUniverse = useMutation({
    mutationFn: async (raw: string) => {
      return apiRequest("PATCH", "/api/user/settings", { scanUniverse: raw });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-ideas"] });
    },
    onError: () => {
      toast({ title: "Couldn't save scan source", description: "Your selection is active for this session.", variant: "destructive" });
    },
  });

  const applyPrefs = (next: ScanPrefs) => {
    setScanPrefs(next);
    saveScanUniverse.mutate(encodeScanPrefs(next));
  };

  const activeBucket = TABS.find((t) => t.value === tab)?.bucket ?? "beginner";
  const { data: ideasResp, isLoading: ideasLoading } = useQuery<IdeasResponse>({
    queryKey: ["/api/daily-ideas", { bucket: activeBucket, universe: scanPrefs.universe, custom: scanPrefs.customSymbols }],
    queryFn: async () => {
      const r = await fetch(buildIdeasUrl(activeBucket, scanPrefs), { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load ideas");
      return r.json();
    },
  });

  const submit = (text: string) => {
    if (!text.trim()) return;
    navigate(routeFor(text));
  };

  const greetingHour = new Date().getHours();
  const greeting =
    greetingHour < 12 ? "Good morning" : greetingHour < 18 ? "Good afternoon" : "Good evening";
  const firstName = user?.firstName || "there";

  const placeholder = useMemo(
    () => PLACEHOLDERS[Math.floor(Date.now() / 60_000) % PLACEHOLDERS.length],
    [],
  );

  return (
    <div className="flex-1 overflow-auto">
      <div className="w-full px-4 md:px-8 py-8 md:py-12 space-y-10">
        <div>
          <h1 className="text-[26px] font-medium tracking-tight" data-testid="text-home-greeting">
            {greeting}, {firstName}.
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1" data-testid="text-home-subtitle">
            {ideasLoading
              ? "Loading today's ideas…"
              : `${ideasResp?.ideas.length ?? 0} ${(ideasResp?.ideas.length ?? 0) === 1 ? "idea" : "ideas"} ready to review — nothing sent without your approval.`}
          </p>
          {ideasResp?.marketRegime && (
            <div
              className={cn(
                "mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs",
                REGIME_TONE[ideasResp.marketRegime.tone],
              )}
              data-testid="banner-market-regime"
            >
              <span className="font-semibold" data-testid="text-market-regime-label">
                Market Environment: {ideasResp.marketRegime.label}
              </span>
              <span className="opacity-80 hidden sm:inline">— {ideasResp.marketRegime.hint}</span>
            </div>
          )}
        </div>

        <section>
          <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
            <div>
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Today's Best Setups
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      data-testid="button-grading-help"
                      aria-label="How grades are calculated"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start" className="max-w-sm text-xs space-y-2">
                    <p className="font-semibold text-sm">How grades are calculated</p>
                    <p className="text-muted-foreground">
                      Each idea gets a 0–100 composite score from five weighted factors, then bucketed into a letter grade:
                    </p>
                    <ul className="space-y-0.5 pl-3 list-disc marker:text-primary/60">
                      <li>Technical setup — {GRADE_WEIGHTS.technical}%</li>
                      <li>Momentum — {GRADE_WEIGHTS.momentum}%</li>
                      <li>News sentiment — {GRADE_WEIGHTS.sentiment}%</li>
                      <li>Liquidity — {GRADE_WEIGHTS.liquidity}%</li>
                      <li>Risk fit — {GRADE_WEIGHTS.risk}%</li>
                    </ul>
                    <div className="text-muted-foreground space-y-0.5 pt-1 border-t">
                      <p><span className="text-foreground font-medium">A+</span> ≥ 90 · strongest agreement</p>
                      <p><span className="text-foreground font-medium">A</span> 80–89 · strong agreement</p>
                      <p><span className="text-foreground font-medium">B</span> 70–79 · moderate agreement</p>
                      <p><span className="text-foreground font-medium">C</span> 50–69 · mixed signals — most ideas land here on quiet days</p>
                    </div>
                    <p className="text-muted-foreground italic pt-1 border-t">
                      Hover any idea's grade badge for the per-factor breakdown. Higher = more factors agree, not a price target.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </h2>
            <p className="text-xs text-muted-foreground mt-1" data-testid="text-ideas-subtitle">
              AI-ranked opportunities based on your selected market and strategy filters.
            </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground hidden sm:inline">View mode</span>
              <div className="flex items-center border rounded-md" data-testid="toggle-card-mode">
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn("rounded-r-none h-8 px-3 text-xs", cardMode === "simple" && "bg-muted")}
                  onClick={() => setCardMode("simple")}
                  data-testid="button-mode-simple"
                >
                  Simple
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn("rounded-l-none h-8 px-3 text-xs border-l", cardMode === "advanced" && "bg-muted")}
                  onClick={() => setCardMode("advanced")}
                  data-testid="button-mode-advanced"
                >
                  Advanced
                </Button>
              </div>
              {ideasResp?.dataMode === "simulated" && (
                <Badge variant="outline" className="text-[10px]" data-testid="badge-simulated">Simulated data</Badge>
              )}
              <span className="text-xs text-muted-foreground hidden sm:inline">Sort by</span>
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
                <SelectTrigger className="h-8 w-[150px] text-xs" data-testid="select-ideas-sort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} data-testid={`option-sort-${opt.value}`}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ViewToggle value={ideasView} onChange={setIdeasView} testId="view-toggle-ideas" />
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Default view settings"
                    data-testid="button-ideas-defaults"
                  >
                    <Settings2 className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 space-y-4">
                  <div>
                    <p className="text-xs font-semibold mb-1">Defaults</p>
                    <p className="text-[11px] text-muted-foreground">
                      Saved on this device — applied next time you open the home page.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Default view</Label>
                    <RadioGroup
                      value={ideasView}
                      onValueChange={(v) => setIdeasView(v as ViewMode)}
                      className="gap-1"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="card" id="def-view-card" data-testid="radio-default-view-card" />
                        <Label htmlFor="def-view-card" className="text-xs font-normal cursor-pointer">Card view</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="list" id="def-view-list" data-testid="radio-default-view-list" />
                        <Label htmlFor="def-view-list" className="text-xs font-normal cursor-pointer">List view</Label>
                      </div>
                    </RadioGroup>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Default show</Label>
                    <RadioGroup
                      value={instrumentFilter}
                      onValueChange={(v) => setInstrumentFilter(v as InstrumentFilter)}
                      className="gap-1"
                    >
                      {INSTRUMENT_FILTERS.map((f) => (
                        <div key={f.value} className="flex items-center gap-2">
                          <RadioGroupItem value={f.value} id={`def-filter-${f.value}`} data-testid={`radio-default-filter-${f.value}`} />
                          <Label htmlFor={`def-filter-${f.value}`} className="text-xs font-normal cursor-pointer">{f.label}</Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                </PopoverContent>
              </Popover>
              <span className="text-xs text-muted-foreground hidden sm:inline">Market universe</span>
              <Select
                value={scanPrefs.universe}
                onValueChange={(v) => {
                  const next: ScanPrefs = { universe: v as ScanUniverseId, customSymbols: scanPrefs.customSymbols };
                  if (next.universe !== "custom") {
                    applyPrefs({ ...next, customSymbols: "" });
                    setCustomDraft("");
                  } else {
                    setScanPrefs(next);
                  }
                }}
              >
                <SelectTrigger className="h-8 w-[180px] text-xs" data-testid="select-scan-universe">
                  <SelectValue placeholder="Auto" />
                </SelectTrigger>
                <SelectContent>
                  {SCAN_UNIVERSE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} data-testid={`option-universe-${opt.value}`}>
                      <span className="font-medium">{opt.label}</span>
                      <span className="block text-[10px] text-muted-foreground">{opt.hint}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {scanPrefs.universe === "custom" && (
            <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
              <Input
                value={customDraft}
                onChange={(e) => setCustomDraft(e.target.value)}
                placeholder="e.g. AAPL, MSFT, NVDA, TSLA"
                className="h-8 max-w-md text-xs"
                data-testid="input-custom-symbols"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyPrefs({ universe: "custom", customSymbols: customDraft });
                  }
                }}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => applyPrefs({ universe: "custom", customSymbols: customDraft })}
                data-testid="button-save-custom-symbols"
              >
                Apply
              </Button>
              <span className="text-muted-foreground">Comma-separated, up to 30 tickers.</span>
            </div>
          )}
          {ideasResp && ideasResp.ideas.length > 0 && (() => {
            const activeFilter = INSTRUMENT_FILTERS.find((f) => f.value === instrumentFilter)!;
            const filteredCount = ideasResp.ideas.filter((i) =>
              matchesInstrumentFilter(i.instrumentType, instrumentFilter),
            ).length;
            return (
              <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="filter-instrument">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground mr-1">Show</span>
                <TooltipProvider delayDuration={150}>
                  {INSTRUMENT_FILTERS.map((f) => {
                    const active = instrumentFilter === f.value;
                    return (
                      <Tooltip key={f.value}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => setInstrumentFilter(f.value)}
                            data-testid={`filter-instrument-${f.value}`}
                            className={cn(
                              "px-3 py-1 rounded-full text-xs transition-colors border",
                              active
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-muted/40 hover:bg-muted text-foreground/80 border-border",
                            )}
                          >
                            {f.label}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-[260px] text-xs leading-snug">
                          {f.hint}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </TooltipProvider>
                <span className="text-[11px] text-muted-foreground ml-1" data-testid="text-instrument-filter-count">
                  {filteredCount} of {ideasResp.ideas.length} match "{activeFilter.label}"
                </span>
              </div>
            );
          })()}
          {(() => {
            const filteredIdeas = ideasResp
              ? ideasResp.ideas.filter((i) => matchesInstrumentFilter(i.instrumentType, instrumentFilter))
              : [];
            return filteredIdeas.length >= 3;
          })() && (() => {
            const filteredIdeas = ideasResp!.ideas.filter((i) =>
              matchesInstrumentFilter(i.instrumentType, instrumentFilter),
            );
            const top3 = sortIdeas(filteredIdeas, sortBy).slice(0, 3);
            const rankBadge = (i: number) =>
              i === 0
                ? "bg-amber-500/15 text-amber-400 border-amber-500/40"
                : i === 1
                  ? "bg-zinc-400/15 text-zinc-300 border-zinc-400/40"
                  : "bg-orange-700/15 text-orange-400 border-orange-700/40";
            return (
              <div className="mb-5 rounded-lg border border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card p-4" data-testid="section-top-picks">
                <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <div>
                      <h3 className="text-sm font-semibold">Top 3 AI-Ranked Setups</h3>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Review only what fits your risk and account settings.
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground">You stay in control. No order is placed without your approval.</span>
                </div>
                {ideasView === "card" ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {top3.map((idea, i) => (
                      <div key={idea.id} className="relative" data-testid={`top-pick-${i + 1}`}>
                        <Badge
                          variant="outline"
                          className={cn(
                            "absolute -top-2 -left-2 z-10 text-[10px] font-bold px-1.5 py-0.5 shadow-sm",
                            rankBadge(i),
                          )}
                        >
                          #{i + 1}
                        </Badge>
                        {cardMode === "simple" ? <SimpleIdeaCard idea={idea} /> : <DailyIdeaCard idea={idea} />}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {top3.map((idea, i) => (
                      <div key={idea.id} className="relative pl-7" data-testid={`top-pick-${i + 1}`}>
                        <Badge
                          variant="outline"
                          className={cn(
                            "absolute top-1/2 -translate-y-1/2 left-0 z-10 text-[10px] font-bold px-1.5 py-0.5 shadow-sm",
                            rankBadge(i),
                          )}
                        >
                          #{i + 1}
                        </Badge>
                        <DailyIdeaRow idea={idea} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
          <Tabs value={tab} onValueChange={setTab}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <TooltipProvider delayDuration={150}>
                <TabsList className="flex-wrap h-auto" data-testid="tabs-daily-ideas">
                  {TABS.map((t) => (
                    <Tooltip key={t.value}>
                      <TooltipTrigger asChild>
                        <TabsTrigger value={t.value} data-testid={`tab-${t.value}`}>
                          {t.label}
                        </TabsTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[240px] text-xs leading-snug">
                        {t.hint}
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </TabsList>
              </TooltipProvider>
            </div>
            {TABS.map((t) => (
              <TabsContent key={t.value} value={t.value} className="mt-4">
                {ideasLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-56 rounded-lg" />
                    ))}
                  </div>
                ) : ideasResp && ideasResp.ideas.length > 0 ? (
                  (() => {
                    // When ≥ 3 ideas (after instrument filter) exist, the first
                    // 3 are featured above as "Top Picks for Your Review" — skip
                    // them here. With < 3 the featured row is hidden, so show
                    // everything that matches the filter.
                    const filteredIdeas = ideasResp.ideas.filter((i) =>
                      matchesInstrumentFilter(i.instrumentType, instrumentFilter),
                    );
                    if (filteredIdeas.length === 0) {
                      return (
                        <div className="text-sm text-muted-foreground py-6 text-center" data-testid="text-no-ideas-for-filter">
                          No ideas match the "{INSTRUMENT_FILTERS.find((f) => f.value === instrumentFilter)!.label}" filter in this tab. Try a different filter or tab.
                        </div>
                      );
                    }
                    const sorted = sortIdeas(filteredIdeas, sortBy);
                    const visible = sorted.length >= 3 ? sorted.slice(3, 12) : sorted;
                    if (visible.length === 0) return null;
                    return ideasView === "card" ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {visible.map((idea) =>
                          cardMode === "simple" ? (
                            <SimpleIdeaCard key={idea.id} idea={idea} />
                          ) : (
                            <DailyIdeaCard key={idea.id} idea={idea} />
                          ),
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {visible.map((idea) => (
                          <DailyIdeaRow key={idea.id} idea={idea} />
                        ))}
                      </div>
                    );
                  })()
                ) : (
                  <Card className="p-6 space-y-3" data-testid="text-no-ideas">
                    <div className="flex items-start gap-2 text-sm">
                      <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="space-y-1">
                        <p className="font-medium">No ideas in this category right now.</p>
                        <p className="text-xs text-muted-foreground">
                          {ideasResp?.brokerConnected === false
                            ? "Your broker isn't connected, so we're running on simulated examples — and the strict filters for this tab didn't surface anything. "
                            : "The filters for this tab didn't surface anything in the current scan. "}
                          Try another tab, build a watchlist, or connect your broker for live data.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {tab !== "all" && (
                        <Button size="sm" variant="outline" onClick={() => setTab("all")} data-testid="button-empty-try-all">
                          Try All ideas
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => navigate("/settings/universes")} data-testid="button-empty-build-watchlist">
                        Build watchlist
                      </Button>
                      {ideasResp?.brokerConnected === false && (
                        <Button size="sm" variant="outline" onClick={() => navigate("/settings")} data-testid="button-empty-connect-broker">
                          Connect broker
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => navigate("/opportunity-radar")} data-testid="button-empty-open-radar">
                        Open Opportunity Radar
                      </Button>
                    </div>
                  </Card>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </section>

        <section>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Ask VCP Trader AI
          </h2>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit(q)}
              placeholder={placeholder}
              className="h-14 pl-11 pr-32 text-[15px] rounded-[14px] border-border focus-visible:ring-1 focus-visible:ring-foreground"
              data-testid="input-home-ask"
            />
            <Button
              onClick={() => submit(q)}
              className="absolute right-2 top-2 h-10 rounded-[10px] gap-2"
              data-testid="button-home-ask"
            >
              Ask <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Ask about a ticker, news, income ideas, or a setup — get an AI-generated answer with live context.
          </p>
        </section>

        <TooltipProvider delayDuration={150}>
        <section data-testid="section-snapshot">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              Today's snapshot
              <InfoHint text="A live read on market tone, indices, biggest movers in your watchlist, and the news catalysts driving them. Click any tile to dig deeper." />
            </h2>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={
                  snap?.dataMode === "live"
                    ? "text-[10px] text-emerald-300 border-emerald-500/40 bg-emerald-500/10"
                    : "text-[10px] text-amber-300 border-amber-500/40 bg-amber-500/10"
                }
                data-testid="badge-snapshot-source"
              >
                {snap?.dataMode === "live" ? "Live broker data" : "Simulated"}
              </Badge>
              <HelpLink section="home" label="Snapshot help" />
            </div>
          </div>

          {/* Row 1 — tone + indices */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Card
              onClick={() => navigate("/market-intel")}
              className="p-4 md:col-span-1 cursor-pointer hover-elevate active-elevate-2"
              data-testid="snapshot-tone"
            >
              <div className="flex items-center gap-1.5 text-[11px] uppercase text-muted-foreground tracking-wide">
                <Activity className="h-3.5 w-3.5" /> Market tone
                <InfoHint text="Derived from SPY, QQQ, and IWM intraday performance. Bullish = all up. Defensive = all down. Mixed = rotation under the surface." />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Badge variant="outline" className={cn("capitalize", TONE_CLASS[snap?.marketTone ?? "mixed"])}>
                  {snap?.marketTone || "Loading"}
                </Badge>
              </div>
              <p className="text-xs mt-2 text-foreground/80 leading-snug line-clamp-3" data-testid="text-tone-reason">
                {snap?.marketToneReason || "Reading market conditions..."}
              </p>
            </Card>

            {(snap?.indices ?? [
              { symbol: "SPY", name: "S&P 500", last: 0, changePercent: 0 },
              { symbol: "QQQ", name: "Nasdaq 100", last: 0, changePercent: 0 },
              { symbol: "IWM", name: "Russell 2000", last: 0, changePercent: 0 },
            ]).slice(0, 3).map((idx) => {
              const up = idx.changePercent >= 0;
              return (
                <Card
                  key={idx.symbol}
                  onClick={() => navigate(`/market-intel?symbol=${idx.symbol}`)}
                  className="p-4 cursor-pointer hover-elevate active-elevate-2"
                  data-testid={`snapshot-index-${idx.symbol}`}
                >
                  <div className="flex items-center justify-between text-[11px] uppercase text-muted-foreground tracking-wide">
                    <span>{idx.name}</span>
                    <span className="font-mono">{idx.symbol}</span>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between">
                    <div className="text-xl font-semibold tabular-nums" data-testid={`text-index-last-${idx.symbol}`}>
                      {idx.last > 0 ? idx.last.toFixed(2) : "—"}
                    </div>
                    <div
                      className={cn(
                        "text-sm font-medium tabular-nums flex items-center gap-1",
                        idx.last === 0 ? "text-muted-foreground" : up ? "text-emerald-400" : "text-rose-400",
                      )}
                      data-testid={`text-index-change-${idx.symbol}`}
                    >
                      {idx.last === 0 ? null : up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                      {idx.last === 0 ? "—" : `${up ? "+" : ""}${idx.changePercent.toFixed(2)}%`}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Row 2 — movers + top news */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <Card className="p-5" data-testid="snapshot-movers">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5 text-[11px] uppercase text-muted-foreground tracking-wide">
                  <TrendingUp className="h-3.5 w-3.5" /> Biggest movers
                  <InfoHint text="Largest absolute % moves from your watchlist (or a default universe if you haven't built one yet). Live broker quotes when connected." />
                </div>
                <span className="text-[10px] text-muted-foreground">{snap?.topMovers?.length ?? 0} symbols</span>
              </div>
              {snap?.topMovers && snap.topMovers.length > 0 ? (
                <ul className="divide-y divide-border/60">
                  {snap.topMovers.slice(0, 5).map((m) => {
                    const up = m.changePercent >= 0;
                    return (
                      <li
                        key={m.symbol}
                        className="flex items-center justify-between py-2 cursor-pointer hover:bg-muted/30 -mx-2 px-2 rounded"
                        onClick={() => navigate(`/market-intel?symbol=${m.symbol}`)}
                        data-testid={`row-mover-${m.symbol}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium font-mono text-sm">{m.symbol}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">${m.last.toFixed(2)}</span>
                        </div>
                        <span className={cn(
                          "text-sm font-medium tabular-nums flex items-center gap-1",
                          up ? "text-emerald-400" : "text-rose-400",
                        )}>
                          {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                          {up ? "+" : ""}{m.changePercent.toFixed(2)}%
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground py-3" data-testid="text-no-movers">
                  Connect a broker to see live movers from your watchlist.
                </p>
              )}
            </Card>

            <Card className="p-5" data-testid="snapshot-news">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5 text-[11px] uppercase text-muted-foreground tracking-wide">
                  <Newspaper className="h-3.5 w-3.5" /> Top news catalysts
                  <InfoHint text="High-buzz stories from the last few hours. Bullish/bearish labels are AI-generated from headline + summary; impact is heuristic." />
                </div>
                <button
                  onClick={() => navigate("/market-intel")}
                  className="text-[10px] text-primary hover:underline"
                  data-testid="link-all-news"
                >
                  View all
                </button>
              </div>
              {snap?.topNews && snap.topNews.length > 0 ? (
                <ul className="space-y-2.5">
                  {snap.topNews.slice(0, 4).map((n, i) => (
                    <li
                      key={`${n.symbol}-${i}`}
                      className="flex gap-2 cursor-pointer hover:bg-muted/30 -mx-2 px-2 py-1 rounded"
                      onClick={() => navigate(`/market-intel?symbol=${n.symbol}`)}
                      data-testid={`row-news-${n.symbol}`}
                    >
                      <Badge
                        variant="outline"
                        className={cn(
                          "h-5 text-[10px] shrink-0 mt-0.5",
                          n.label === "bullish" && "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
                          n.label === "bearish" && "border-rose-500/40 text-rose-300 bg-rose-500/10",
                          n.label === "neutral" && "border-border text-muted-foreground",
                        )}
                      >
                        {n.symbol}
                      </Badge>
                      <p className="text-xs leading-snug text-foreground/80 line-clamp-2 flex-1">{n.whyItMatters}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground py-3">
                  No high-impact stories tracked right now. Check back during market hours.
                </p>
              )}
            </Card>
          </div>

          {/* Row 3 — actionable: income / growth / watchlist alert */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <Card
              onClick={() => navigate("/income-mode")}
              className="p-5 cursor-pointer hover-elevate active-elevate-2"
              data-testid="snapshot-income"
            >
              <div className="flex items-center gap-1.5 text-[11px] uppercase text-muted-foreground tracking-wide">
                <DollarSign className="h-3.5 w-3.5" /> Best income idea
                <InfoHint text="Today's highest-rated covered call, cash-secured put, or defined-risk premium-selling candidate." />
              </div>
              <div className="mt-3 text-2xl font-medium" data-testid="text-income-symbol">
                {snap?.bestIncome?.symbol || "—"}
              </div>
              <p className="text-xs mt-2 text-foreground/80 leading-snug line-clamp-3">
                {snap?.bestIncome?.headline || "Looking for income candidates..."}
              </p>
            </Card>

            <Card
              onClick={() => snap?.topGrowth?.symbol && navigate(`/market-intel?symbol=${snap.topGrowth.symbol}`)}
              className="p-5 cursor-pointer hover-elevate active-elevate-2"
              data-testid="snapshot-growth"
            >
              <div className="flex items-center gap-1.5 text-[11px] uppercase text-muted-foreground tracking-wide">
                <TrendingUp className="h-3.5 w-3.5" /> Top growth opportunity
                <InfoHint text="Symbol with the strongest combination of bullish news flow and trending buzz score this session." />
              </div>
              <div className="mt-3 text-2xl font-medium" data-testid="text-growth-symbol">
                {snap?.topGrowth?.symbol || "—"}
              </div>
              <p className="text-xs mt-2 text-foreground/80 leading-snug line-clamp-3">
                {snap?.topGrowth?.headline || "Looking for growth candidates..."}
              </p>
            </Card>

            <Card
              onClick={() => snap?.watchlistAlert
                ? navigate(`/market-intel?symbol=${snap.watchlistAlert.symbol}`)
                : navigate("/market-intel")
              }
              className={cn(
                "p-5 cursor-pointer hover-elevate active-elevate-2",
                snap?.watchlistAlert && "border-rose-500/30 bg-rose-500/5",
              )}
              data-testid="snapshot-watchlist-alert"
            >
              <div className="flex items-center gap-1.5 text-[11px] uppercase text-muted-foreground tracking-wide">
                <AlertTriangle className="h-3.5 w-3.5" /> Watchlist alert
                <InfoHint text="Bearish news flow on a symbol from your watchlist that may warrant review. If empty, no flagged risks right now." />
              </div>
              <div className="mt-3 text-2xl font-medium" data-testid="text-watchlist-alert-symbol">
                {snap?.watchlistAlert?.symbol || "All clear"}
              </div>
              <p className="text-xs mt-2 text-foreground/80 leading-snug line-clamp-3">
                {snap?.watchlistAlert?.message || "No flagged risks on your watchlist right now."}
              </p>
            </Card>
          </div>
        </section>
        </TooltipProvider>

        <section>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
            What do you want to do?
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {ACTIONS.map((a) => (
              <Card
                key={a.title}
                onClick={() => navigate(a.href)}
                className="p-6 cursor-pointer hover-elevate active-elevate-2 group"
                data-testid={a.testId}
              >
                <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${a.color}`}>
                  <a.icon className="h-5 w-5" />
                </div>
                <div className="mt-4 text-base font-medium">{a.title}</div>
                <div className="text-sm text-muted-foreground mt-1">{a.desc}</div>
              </Card>
            ))}
          </div>
        </section>

        <p className="text-xs text-muted-foreground pt-6 border-t leading-relaxed" data-testid="text-home-disclaimer">
          These ideas are for educational and informational purposes only. They are not investment advice or personalized recommendations. You decide whether any setup fits your objectives, risk tolerance, and account.
        </p>
      </div>
    </div>
  );
}
