import { useLocation } from "wouter";
import { TrendingUp, DollarSign, Search, Newspaper } from "lucide-react";
import { HomeActionCard, BrokerStatusStrip, ComplianceFooter } from "@/components/trading-shell";

export default function HomeDashboard() {
  const [, navigate] = useLocation();

  return (
    <div className="flex-1 p-4 md:p-6 max-w-6xl mx-auto w-full space-y-6">
      <div className="space-y-1">
        <h1
          className="text-2xl md:text-3xl font-bold tracking-tight"
          data-testid="text-home-headline"
        >
          What would you like help with today?
        </h1>
        <p className="text-sm text-muted-foreground">
          Pick a path. Each one walks you through, shows scenarios, and never sends an order without your review.
        </p>
      </div>

      <BrokerStatusStrip />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <HomeActionCard
          title="Grow My Account"
          subtitle="Explore risk-aware growth scenarios"
          icon={TrendingUp}
          accent="blue"
          testId="card-action-grow"
          onClick={() => navigate("/goal-mode?goal=account_growth")}
        />
        <HomeActionCard
          title="Generate Income"
          subtitle="Find covered call, cash-secured put, and defined-risk income ideas"
          icon={DollarSign}
          accent="emerald"
          testId="card-action-income"
          onClick={() => navigate("/income-mode")}
        />
        <HomeActionCard
          title="Find a Trade"
          subtitle="Describe a setup in plain English"
          icon={Search}
          accent="violet"
          testId="card-action-find"
          onClick={() => navigate("/trade-finder")}
        />
        <HomeActionCard
          title="Understand Markets"
          subtitle="Summarize news, catalysts, and watchlist impact"
          icon={Newspaper}
          accent="amber"
          testId="card-action-markets"
          onClick={() => navigate("/market-intel")}
        />
      </div>

      <ComplianceFooter />
    </div>
  );
}
