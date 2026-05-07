import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  ArrowRight,
  TrendingUp,
  DollarSign,
  Newspaper,
  BarChart3,
  Sparkles,
  X,
} from "lucide-react";

const PLAN_DISMISSED_KEY = "home_plan_card_dismissed";

interface Snapshot {
  marketTone: string;
  marketToneReason: string;
  bestIncome: { symbol: string; headline: string } | null;
  topGrowth: { symbol: string; headline: string } | null;
  watchlistAlert: { symbol: string; reason: string } | null;
  asOf: string;
  disclaimer: string;
}

const ACTIONS = [
  {
    title: "Grow my money",
    desc: "Risk-aware ideas for long-term growth",
    icon: TrendingUp,
    href: "/goal-mode",
    color: "bg-violet-100 text-violet-700",
    testId: "card-action-grow",
  },
  {
    title: "Find a trade",
    desc: "Describe a setup in plain English",
    icon: Search,
    href: "/scanner",
    color: "bg-emerald-100 text-emerald-700",
    testId: "card-action-find",
  },
  {
    title: "Generate income",
    desc: "Covered calls, premium, monthly cash flow",
    icon: DollarSign,
    href: "/income-mode",
    color: "bg-amber-100 text-amber-700",
    testId: "card-action-income",
  },
  {
    title: "Understand markets",
    desc: "News, catalysts, sentiment",
    icon: Newspaper,
    href: "/market-intel",
    color: "bg-sky-100 text-sky-700",
    testId: "card-action-markets",
  },
];

const POPULAR = [
  "Grow $10k conservatively",
  "Income ideas under $200 risk",
  "Why is TSLA moving?",
  "Best setups today",
  "Covered call ideas",
];

export default function HomeV2() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [showPlanCard, setShowPlanCard] = useState(false);

  useEffect(() => {
    try {
      setShowPlanCard(localStorage.getItem(PLAN_DISMISSED_KEY) !== "1");
    } catch {
      setShowPlanCard(true);
    }
  }, []);

  const dismissPlanCard = () => {
    try {
      localStorage.setItem(PLAN_DISMISSED_KEY, "1");
    } catch {}
    setShowPlanCard(false);
  };

  const { data: snap } = useQuery<Snapshot>({
    queryKey: ["/api/home/snapshot"],
    refetchInterval: 60_000,
  });

  const submit = (text: string) => {
    if (!text.trim()) return;
    navigate(`/results?q=${encodeURIComponent(text.trim())}`);
  };

  const greetingHour = new Date().getHours();
  const greeting =
    greetingHour < 12 ? "Good morning" : greetingHour < 18 ? "Good afternoon" : "Good evening";
  const firstName = user?.firstName || "there";

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 md:py-12 space-y-10">
        <div>
          <h1 className="text-[26px] font-medium tracking-tight" data-testid="text-home-greeting">
            {greeting}, {firstName}.
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            Here's what's worth your attention today.
          </p>
        </div>

        <div className="relative">
          <Search className="h-4 w-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit(q)}
            placeholder="Ask anything — 'How do I grow $10k safely?' or 'Show me iron condor setups'"
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

        {showPlanCard && (
          <Card
            className="p-4 md:p-5 bg-violet-50/60 border-violet-200 flex items-center justify-between gap-4"
            data-testid="card-personalized-plan"
          >
            <div className="flex items-start gap-3 min-w-0">
              <div className="h-9 w-9 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center shrink-0">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-violet-900">
                  First time? Build a personalized plan
                </div>
                <p className="text-xs text-violet-900/70 mt-0.5">
                  Tell us your capital, goal, and risk tolerance — we'll match you with setups that fit.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="sm"
                onClick={() => navigate("/goal-mode")}
                className="bg-violet-700 hover:bg-violet-800 text-white"
                data-testid="button-build-plan"
              >
                Build my plan <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={dismissPlanCard}
                className="text-violet-900/60 hover:text-violet-900 h-8 w-8"
                aria-label="Dismiss"
                data-testid="button-dismiss-plan"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </Card>
        )}

        <section>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
            Today's snapshot
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card className="p-5" data-testid="snapshot-tone">
              <div className="text-[11px] uppercase text-muted-foreground tracking-wide">
                Market tone
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Badge variant="outline" className="bg-amber-50 border-amber-200 text-amber-800 capitalize">
                  {snap?.marketTone || "Loading"}
                </Badge>
              </div>
              <p className="text-sm mt-3 text-foreground/80 leading-snug">
                {snap?.marketToneReason || "Reading market conditions..."}
              </p>
            </Card>

            <Card className="p-5" data-testid="snapshot-income">
              <div className="text-[11px] uppercase text-muted-foreground tracking-wide">
                Best income setup
              </div>
              <div className="mt-3 text-2xl font-medium" data-testid="text-income-symbol">
                {snap?.bestIncome?.symbol || "—"}
              </div>
              <p className="text-sm mt-2 text-foreground/80 leading-snug">
                {snap?.bestIncome?.headline || "Looking for income candidates..."}
              </p>
            </Card>

            <Card className="p-5" data-testid="snapshot-growth">
              <div className="text-[11px] uppercase text-muted-foreground tracking-wide">
                Top opportunity
              </div>
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
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
            Popular right now
          </h2>
          <div className="flex flex-wrap gap-2">
            {POPULAR.map((p) => (
              <button
                key={p}
                onClick={() => submit(p)}
                className="rounded-full border border-border bg-muted/40 hover:bg-muted text-sm px-4 py-2 transition-colors"
                data-testid={`pill-popular-${p.slice(0, 12).toLowerCase().replace(/\s+/g, "-")}`}
              >
                {p}
              </button>
            ))}
          </div>
        </section>

        <p className="text-xs text-muted-foreground pt-6 border-t">
          {snap?.disclaimer ||
            "Software-generated context for informational use only — not financial advice."}
        </p>
      </div>
    </div>
  );
}
