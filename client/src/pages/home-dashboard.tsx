import { useMemo } from "react";
import { useLocation } from "wouter";
import { Search, Sparkles, ArrowRight, Target } from "lucide-react";
import { HomeActionCard, ComplianceFooter } from "@/components/trading-shell";
import { QuickPromptBar } from "@/components/home/quick-prompt-bar";
import { AiSnapshotPanel } from "@/components/home/ai-snapshot-panel";
import { PopularChips } from "@/components/home/popular-chips";
import { QuotaBanner } from "@/components/quota-banner";
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

      {/* Main grid: single merged action card + Ask AI + snapshot panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            <HomeActionCard
              title="Find a Trade"
              subtitle="Describe a stock or options setup in plain English. Ranked candidates include live news, sentiment, and technical indicators."
              icon={Search}
              accent="violet"
              testId="card-action-find"
              onClick={() => navigate("/trade-finder")}
            />
            <HomeActionCard
              title="Find My Best Trade"
              subtitle="Scan your watchlist or major indexes for the highest-confidence defined-risk trade right now — no naked long calls or puts."
              icon={Target}
              accent="emerald"
              testId="card-action-best-trade"
              onClick={() => navigate("/best-trade")}
            />
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
