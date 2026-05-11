import { useMemo } from "react";
import { useLocation } from "wouter";
import { TrendingUp, DollarSign, Search, Newspaper, GraduationCap, Layers } from "lucide-react";
import { HomeActionCard, ComplianceFooter } from "@/components/trading-shell";
import { QuickPromptBar } from "@/components/home/quick-prompt-bar";
import { AiSnapshotPanel } from "@/components/home/ai-snapshot-panel";
import { PopularChips } from "@/components/home/popular-chips";
import { QuotaBanner } from "@/components/quota-banner";
import { usePersona } from "@/context/PersonaContext";
import type { TraderPersona } from "@shared/plans";

interface ActionCard {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: "blue" | "emerald" | "violet" | "amber";
  testId: string;
  href: string;
}

const ACTION_CARDS: Record<string, ActionCard> = {
  grow: {
    id: "grow",
    title: "Grow My Money",
    subtitle: "Explore risk-aware growth opportunities",
    icon: TrendingUp,
    accent: "blue",
    testId: "card-action-grow",
    href: "/goal-mode?goal=account_growth",
  },
  income: {
    id: "income",
    title: "Generate Income",
    subtitle: "Covered calls, cash-secured puts, and monthly income ideas",
    icon: DollarSign,
    accent: "emerald",
    testId: "card-action-income",
    href: "/income-mode",
  },
  find: {
    id: "find",
    title: "Find a Trade",
    subtitle: "Describe what you want in plain English",
    icon: Search,
    accent: "violet",
    testId: "card-action-find",
    href: "/trade-finder",
  },
  markets: {
    id: "markets",
    title: "Understand Markets",
    subtitle: "News, catalysts, sentiment, and watchlist impact",
    icon: Newspaper,
    accent: "amber",
    testId: "card-action-markets",
    href: "/market-intel",
  },
  multileg: {
    id: "multileg",
    title: "Options & Spreads",
    subtitle: "Scan options flow, find spreads & condors",
    icon: Layers,
    accent: "violet",
    testId: "card-action-multileg",
    href: "/discover?tab=options",
  },
  learn: {
    id: "learn",
    title: "Learn the Basics",
    subtitle: "Walkthroughs, glossary, and worked examples",
    icon: GraduationCap,
    accent: "amber",
    testId: "card-action-learn",
    href: "/help",
  },
};

const PERSONA_HERO: Record<TraderPersona | "default", { title: string; subtitle: string; cards: string[] }> = {
  buyer: {
    title: "What growth idea should we explore today?",
    subtitle: "We surface stocks and ETFs aligned with your goals — with risk explained, not hidden.",
    cards: ["grow", "find", "markets", "income"],
  },
  seller: {
    title: "Let's find your next premium-selling setup.",
    subtitle: "Covered calls, cash-secured puts, and monthly income ideas — sized to your account.",
    cards: ["income", "markets", "find", "grow"],
  },
  complex: {
    title: "Ready to structure your next trade?",
    subtitle: "Multi-leg spreads, options flow, and defined-risk plays with the math shown.",
    cards: ["find", "multileg", "income", "markets"],
  },
  learner: {
    title: "Welcome — let's learn one idea at a time.",
    subtitle: "Plain-English walkthroughs, sample setups, and zero pressure to trade.",
    cards: ["learn", "markets", "grow", "find"],
  },
  default: {
    title: "What would you like help with today?",
    subtitle: "Tell VCP Trader AI your goal. We'll show scenarios, explain risks, and never send orders without your review.",
    cards: ["grow", "income", "find", "markets"],
  },
};

export default function HomeDashboard() {
  const [, navigate] = useLocation();
  const { persona } = usePersona();

  const hero = useMemo(() => PERSONA_HERO[persona ?? "default"] ?? PERSONA_HERO.default, [persona]);
  const cards = useMemo(() => hero.cards.map((id) => ACTION_CARDS[id]).filter(Boolean), [hero.cards]);

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

      {/* Main grid: action cards + snapshot panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            {cards.map((card) => (
              <HomeActionCard
                key={card.id}
                title={card.title}
                subtitle={card.subtitle}
                icon={card.icon}
                accent={card.accent}
                testId={card.testId}
                onClick={() => navigate(card.href)}
              />
            ))}
          </div>
        </div>

        <aside className="lg:col-span-1">
          <AiSnapshotPanel />
        </aside>
      </div>

      {/* Popular chips */}
      <PopularChips />

      <ComplianceFooter />
    </div>
  );
}
