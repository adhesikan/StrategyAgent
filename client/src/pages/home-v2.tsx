import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";
import { DailyIdeaCard, type DailyIdea } from "@/components/daily-idea-card";

interface Snapshot {
  marketTone: string;
  marketToneReason: string;
  bestIncome: { symbol: string; headline: string } | null;
  topGrowth: { symbol: string; headline: string } | null;
  watchlistAlert: { symbol: string; reason: string } | null;
  asOf: string;
  disclaimer: string;
}

interface IdeasResponse {
  ideas: DailyIdea[];
  brokerConnected: boolean;
  dataMode: "live" | "simulated";
  asOf: string;
  disclaimer: string;
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

const TABS: { value: string; label: string; bucket: string }[] = [
  { value: "all", label: "All", bucket: "beginner" },
  { value: "stocks", label: "Stocks", bucket: "stocks" },
  { value: "options", label: "Options", bucket: "options" },
  { value: "income", label: "Income", bucket: "income" },
  { value: "watchlist", label: "Watchlist", bucket: "watchlist" },
  { value: "alerts", label: "Market Alerts", bucket: "watchlist" },
];

function routeFor(prompt: string): string {
  const p = prompt.toLowerCase();
  if (/grow|growth|long.term|invest/.test(p)) return "/goal-mode";
  if (/income|premium|cover|cash.?secured|csp|wheel|dividend/.test(p)) return "/income-mode";
  if (/why|moving|news|sentiment|catalyst|earnings/.test(p)) return "/market-intel";
  return `/trade-finder?q=${encodeURIComponent(prompt.trim())}`;
}

export default function HomeV2() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("all");

  const { data: snap } = useQuery<Snapshot>({
    queryKey: ["/api/home/snapshot"],
    refetchInterval: 60_000,
  });

  const activeBucket = TABS.find((t) => t.value === tab)?.bucket ?? "beginner";
  const { data: ideasResp, isLoading: ideasLoading } = useQuery<IdeasResponse>({
    queryKey: ["/api/daily-ideas", { bucket: activeBucket }],
    queryFn: async () => {
      const r = await fetch(`/api/daily-ideas?bucket=${activeBucket}`, { credentials: "include" });
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
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 md:py-12 space-y-10">
        <div>
          <h1 className="text-[26px] font-medium tracking-tight" data-testid="text-home-greeting">
            {greeting}, {firstName}.
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            What would you like help with today?
          </p>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            VCP Trader AI scans stocks, options, news, market sentiment, and your selected limits to
            surface ideas you can review — nothing is sent without your approval.
          </p>
        </div>

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

        <section>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
            Today's snapshot
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card className="p-5" data-testid="snapshot-tone">
              <div className="text-[11px] uppercase text-muted-foreground tracking-wide">Market tone</div>
              <div className="mt-3 flex items-center gap-2">
                <Badge variant="outline" className="bg-amber-50 border-amber-200 text-amber-800 capitalize dark:bg-amber-500/15 dark:text-amber-300">
                  {snap?.marketTone || "Loading"}
                </Badge>
              </div>
              <p className="text-sm mt-3 text-foreground/80 leading-snug">
                {snap?.marketToneReason || "Reading market conditions..."}
              </p>
            </Card>
            <Card className="p-5" data-testid="snapshot-income">
              <div className="text-[11px] uppercase text-muted-foreground tracking-wide">Best income idea</div>
              <div className="mt-3 text-2xl font-medium" data-testid="text-income-symbol">
                {snap?.bestIncome?.symbol || "—"}
              </div>
              <p className="text-sm mt-2 text-foreground/80 leading-snug">
                {snap?.bestIncome?.headline || "Looking for income candidates..."}
              </p>
            </Card>
            <Card className="p-5" data-testid="snapshot-growth">
              <div className="text-[11px] uppercase text-muted-foreground tracking-wide">Top growth opportunity</div>
              <div className="mt-3 text-2xl font-medium" data-testid="text-growth-symbol">
                {snap?.topGrowth?.symbol || "—"}
              </div>
              <p className="text-sm mt-2 text-foreground/80 leading-snug">
                {snap?.topGrowth?.headline || "Looking for growth candidates..."}
              </p>
            </Card>
          </div>
        </section>

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

        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Today's Ideas For You
            </h2>
            {ideasResp?.dataMode === "simulated" && (
              <Badge variant="outline" className="text-[10px]">Simulated data</Badge>
            )}
          </div>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex-wrap h-auto" data-testid="tabs-daily-ideas">
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} data-testid={`tab-${t.value}`}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {TABS.map((t) => (
              <TabsContent key={t.value} value={t.value} className="mt-4">
                {ideasLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-56 rounded-lg" />
                    ))}
                  </div>
                ) : ideasResp && ideasResp.ideas.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {ideasResp.ideas.slice(0, 9).map((idea) => (
                      <DailyIdeaCard key={idea.id} idea={idea} />
                    ))}
                  </div>
                ) : (
                  <Card className="p-8 text-center text-sm text-muted-foreground" data-testid="text-no-ideas">
                    No ideas in this category right now. Try another tab or adjust your watchlist.
                  </Card>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </section>

        <p className="text-xs text-muted-foreground pt-6 border-t" data-testid="text-home-disclaimer">
          {ideasResp?.disclaimer ||
            snap?.disclaimer ||
            "Software-generated context for informational use only — not financial advice. Review before acting."}
        </p>
      </div>
    </div>
  );
}
