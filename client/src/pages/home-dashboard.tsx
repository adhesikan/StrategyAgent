import { useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Search, ArrowRight, ShieldCheck, TrendingUp, Wallet, LineChart } from "lucide-react";
import { HomeActionCard, ComplianceFooter } from "@/components/trading-shell";
import type { PositionProtectionPlan } from "@shared/schema";
import { QuickPromptBar } from "@/components/home/quick-prompt-bar";
import { AiSnapshotPanel } from "@/components/home/ai-snapshot-panel";
import { PopularChips } from "@/components/home/popular-chips";
import { QuotaBanner } from "@/components/quota-banner";
import { StartChoiceDialog, PersonalizationPromptCard, IncompletePreferencesDisclosure } from "@/components/start-choice";
import { TodaysOpportunities, NeedsAttention, PositionsSummaryOrConnect } from "@/components/home/home-sections";
import { usePersona } from "@/context/PersonaContext";
import type { TraderPersona } from "@shared/plans";

const PERSONA_HERO: Record<TraderPersona | "default", { title: string; subtitle: string }> = {
  buyer: {
    title: "What growth idea should we explore today?",
    subtitle: "Describe a stock or setup in plain English — we'll surface ranked candidates with news, sentiment, and technicals built in.",
  },
  seller: {
    title: "Let's find your next premium-selling setup.",
    subtitle: "Tell us what you want — covered calls, cash-secured puts, or defined-risk plays — with markets context built right in.",
  },
  complex: {
    title: "Ready to structure your next trade?",
    subtitle: "Describe a multi-leg or directional setup. We'll rank candidates and pull live news, sentiment, and indicators in one place.",
  },
  learner: {
    title: "Welcome — let's find one idea to learn from today.",
    subtitle: "Type what you're curious about. We'll show ideas with risk, news, and the math explained in plain English.",
  },
  default: {
    title: "What would you like help with today?",
    subtitle: "Describe a trade or ask a market question. VCP Trader AI ranks candidates and pulls live news, sentiment, and indicators in one place.",
  },
};

export default function HomeDashboard() {
  const [, navigate] = useLocation();
  const { persona } = usePersona();

  const hero = useMemo(() => PERSONA_HERO[persona ?? "default"] ?? PERSONA_HERO.default, [persona]);

  const { data: protectionPlans = [] } = useQuery<PositionProtectionPlan[]>({
    queryKey: ["/api/position-protection/plans"],
  });
  const activeProtected = protectionPlans.filter(
    (p) => p.status === "active" || p.status === "paused",
  ).length;

  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full space-y-6 md:space-y-8">
      {/* Hero */}
      <div className="space-y-3">
        <div className="space-y-2">
          <h1
            className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight"
            data-testid="text-home-headline"
          >
            {hero.title}
          </h1>
          <p className="text-sm md:text-base text-muted-foreground max-w-2xl" data-testid="text-home-subtitle">
            {hero.subtitle}
          </p>
        </div>

        <QuickPromptBar />
      </div>

      {/* Quota banner (only shows when usage > 80%) */}
      <QuotaBanner />

      {/* Optional onboarding: start choice for brand-new users, dismissible personalization prompt */}
      <StartChoiceDialog />
      <PersonalizationPromptCard />

      {/* Position Protection summary (only when protecting positions) */}
      {activeProtected > 0 && (
        <button
          type="button"
          onClick={() => navigate("/history")}
          data-testid="card-home-protection"
          className="w-full flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-left transition-colors hover:bg-emerald-500/10"
        >
          <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold" data-testid="text-protection-count">
              {activeProtected} position{activeProtected === 1 ? "" : "s"} with Exit Protection active
            </p>
            <p className="text-xs text-muted-foreground">
              App-monitored stop, target, and trailing rules. Exits route as standard orders — fills aren't guaranteed.
            </p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      )}

      {/* Needs Your Attention (only when relevant) */}
      <NeedsAttention />

      {/* Main grid: four primary actions + snapshot panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            <HomeActionCard
              title="Grow"
              subtitle="Set a growth goal and review ranked candidate scenarios sized to your capital and risk limits."
              icon={TrendingUp}
              accent="emerald"
              testId="card-action-grow"
              onClick={() => navigate("/goal-mode")}
            />
            <HomeActionCard
              title="Income"
              subtitle="Explore covered calls, cash-secured puts, and defined-risk income candidates."
              icon={Wallet}
              accent="blue"
              testId="card-action-income"
              onClick={() => navigate("/income-mode")}
            />
            <HomeActionCard
              title="Find a Trade"
              subtitle="Describe a stock or options setup in plain English. Ranked candidates include news, sentiment, and technical indicators."
              icon={Search}
              accent="violet"
              testId="card-action-find"
              onClick={() => navigate("/trade-finder")}
            />
            <HomeActionCard
              title="Understand Markets"
              subtitle="Morning briefing, why a stock is moving, watchlist sentiment, and top catalysts."
              icon={LineChart}
              accent="amber"
              testId="card-action-markets"
              onClick={() => navigate("/market-intel")}
            />
          </div>
        </div>

        <aside className="lg:col-span-1">
          <AiSnapshotPanel />
        </aside>
      </div>

      {/* Today's Opportunities */}
      <TodaysOpportunities />
      <IncompletePreferencesDisclosure />

      {/* Positions summary / connect CTA */}
      <PositionsSummaryOrConnect />

      {/* Popular chips */}
      <PopularChips />

      <ComplianceFooter />
    </div>
  );
}
