import { useLocation } from "wouter";
import { TrendingUp, DollarSign, Search, Newspaper } from "lucide-react";
import { HomeActionCard, BrokerStatusStrip, ComplianceFooter } from "@/components/trading-shell";
import { QuickPromptBar } from "@/components/home/quick-prompt-bar";
import { AiSnapshotPanel } from "@/components/home/ai-snapshot-panel";
import { PopularChips } from "@/components/home/popular-chips";
import { NewHereBadge } from "@/components/home/new-here-badge";

export default function HomeDashboard() {
  const [, navigate] = useLocation();

  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full space-y-6 md:space-y-8">
      {/* Hero */}
      <div className="space-y-3">
        <div className="space-y-2">
          <h1
            className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight"
            data-testid="text-home-headline"
          >
            What would you like help with today?
          </h1>
          <p className="text-sm md:text-base text-muted-foreground max-w-2xl">
            Tell Strategy Agent your goal. We'll show scenarios, explain risks, and never send orders without your review.
          </p>
        </div>

        <QuickPromptBar />
      </div>

      {/* Status pills */}
      <BrokerStatusStrip />

      {/* New Here badge */}
      <div>
        <NewHereBadge />
      </div>

      {/* Main grid: action cards + snapshot panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            <HomeActionCard
              title="Grow My Money"
              subtitle="Explore risk-aware growth opportunities"
              icon={TrendingUp}
              accent="blue"
              testId="card-action-grow"
              onClick={() => navigate("/goal-mode?goal=account_growth")}
            />
            <HomeActionCard
              title="Generate Income"
              subtitle="Covered calls, cash-secured puts, and monthly income ideas"
              icon={DollarSign}
              accent="emerald"
              testId="card-action-income"
              onClick={() => navigate("/income-mode")}
            />
            <HomeActionCard
              title="Find a Trade"
              subtitle="Describe what you want in plain English"
              icon={Search}
              accent="violet"
              testId="card-action-find"
              onClick={() => navigate("/trade-finder")}
            />
            <HomeActionCard
              title="Understand Markets"
              subtitle="News, catalysts, sentiment, and watchlist impact"
              icon={Newspaper}
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

      {/* Popular chips */}
      <PopularChips />

      <ComplianceFooter />
    </div>
  );
}
