import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  GoalModeWizard,
  GoalRealityCheck,
  CandidateScenarioCard,
  CandidateScenarioRow,
  OrderReviewModal,
  type GoalModePrefs,
  type CandidateScenario,
} from "@/components/goal-mode-shell";
import { BrokerStatusStrip, ComplianceFooter } from "@/components/trading-shell";
import { DailyIdeasSection } from "@/components/daily-ideas-section";
import { Target, RotateCcw, LayoutGrid, List } from "lucide-react";
import { HelpLink } from "@/components/help-link";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import { HowToUseSection } from "@/components/how-to-use-section";
import { cn } from "@/lib/utils";

const MOCK_SCENARIOS: CandidateScenario[] = [
  {
    id: "scn-1",
    ticker: "AAPL",
    strategyType: "Cash-Secured Put",
    bias: "Neutral",
    capitalRequired: 17500,
    maxLoss: 17500,
    maxGain: 185,
    breakeven: 173.15,
    probabilityGrade: "A",
    liquidity: "High",
    why: "AAPL is consolidating near support with elevated put premiums and strong long-term trend.",
    risks: ["Assignment if AAPL closes below strike at expiry", "Capital tied up for ~30 days"],
  },
  {
    id: "scn-2",
    ticker: "SPY",
    strategyType: "Covered Call",
    bias: "Neutral",
    capitalRequired: 50800,
    maxLoss: 50800,
    maxGain: 240,
    breakeven: 506.6,
    probabilityGrade: "A+",
    liquidity: "High",
    why: "Existing SPY position can earn premium with low volatility regime in the broad market.",
    risks: ["Cap on upside if SPY rallies above strike", "Standard market downside exposure"],
  },
  {
    id: "scn-3",
    ticker: "AMD",
    strategyType: "Bull Call Spread",
    bias: "Bullish",
    capitalRequired: 185,
    maxLoss: 185,
    maxGain: 315,
    breakeven: 153.85,
    probabilityGrade: "B",
    liquidity: "High",
    why: "AMD pulled back to a prior breakout level and momentum is turning positive.",
    risks: ["Defined max loss equal to debit paid", "Trade could decay if AMD stalls"],
  },
];

export default function GoalModePage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [prefs, setPrefs] = useState<GoalModePrefs | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [activeScenario, setActiveScenario] = useState<CandidateScenario | null>(null);
  const [viewMode, setViewMode] = useState<"card" | "list">("card");
  const { isConnected: brokerConnected } = useBrokerStatus();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("wizard") === "1") setWizardOpen(true);
  }, []);

  const handleComplete = (p: GoalModePrefs) => {
    setPrefs(p);
    setWizardOpen(false);
  };

  const handleReview = (s: CandidateScenario) => {
    toast({ title: `${s.ticker} details`, description: s.why });
  };

  const handlePrepareOrder = (s: CandidateScenario) => {
    setActiveScenario(s);
    setReviewOpen(true);
  };

  const handleSend = () => {
    if (!activeScenario) return;
    toast({
      title: brokerConnected ? "Order sent" : "Simulated order placed",
      description: `${activeScenario.ticker} ${activeScenario.strategyType} submitted for review.`,
    });
  };

  const filteredScenarios = prefs
    ? MOCK_SCENARIOS.filter((s) => {
        if (s.maxLoss > prefs.maxRiskPerTrade && s.strategyType !== "Cash-Secured Put" && s.strategyType !== "Covered Call") {
          return false;
        }
        return true;
      })
    : MOCK_SCENARIOS;

  return (
    <div className="flex-1 p-4 md:p-6 max-w-6xl mx-auto w-full space-y-6">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Target className="h-6 w-6 text-primary" />
            Grow
          </h1>
          <HelpLink section="grow" />
        </div>
        <p className="text-sm text-muted-foreground">
          Explore stock and options opportunities that fit your selected limits.
        </p>
      </div>

      <BrokerStatusStrip />

      <HowToUseSection
        testIdSlug="grow"
        steps={[
          { title: "Set your goal", detail: "Tell us your capital, risk tolerance, and how active you want to be. We tailor candidates to those limits." },
          { title: "Browse ranked ideas", detail: "Each card shows the strategy, capital required, max loss/gain, and breakeven. Higher grade (A+/A) means stronger signal." },
          { title: "Review before sending", detail: "Click Review or Prepare Order to see full context. You always confirm before any order leaves the app." },
          { title: "Toggle list view", detail: "Use the grid/list buttons (top-right) to switch how ideas are displayed." },
        ]}
      />

      <DailyIdeasSection
        bucket="growth"
        title="Your Growth Ideas"
        subtitle="Stock & options candidates ranked for growth potential — review before acting."
        limit={6}
      />

      <DailyIdeasSection
        bucket="options"
        title="Options Opportunities"
        subtitle="Defined-risk option setups aligned with your limits."
        limit={3}
      />

      <DailyIdeasSection
        bucket="watchlist"
        title="Watchlist Ideas"
        subtitle="Ideas pulled from symbols on your watchlist."
        limit={3}
        emptyText="Add symbols to your watchlist to see ideas here."
      />

      {prefs && (
        <>
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Showing {filteredScenarios.length} candidate scenario{filteredScenarios.length === 1 ? "" : "s"} for your goal.
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPrefs(null);
                setWizardOpen(true);
              }}
              data-testid="button-redo-wizard"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Redo
            </Button>
          </div>

          <GoalRealityCheck prefs={prefs} />

          <div>
            <div className="flex items-center justify-between mb-3 gap-3">
              <h2 className="text-lg font-semibold">Candidate Scenarios</h2>
              <div className="flex items-center border rounded-md" data-testid="view-toggle-grow">
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("rounded-r-none h-8 w-8", viewMode === "card" && "bg-muted")}
                  onClick={() => setViewMode("card")}
                  aria-label="Card view"
                  data-testid="button-view-card"
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("rounded-l-none h-8 w-8", viewMode === "list" && "bg-muted")}
                  onClick={() => setViewMode("list")}
                  aria-label="List view"
                  data-testid="button-view-list"
                >
                  <List className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {viewMode === "card" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredScenarios.map((s) => (
                  <CandidateScenarioCard
                    key={s.id}
                    scenario={s}
                    onReview={() => handleReview(s)}
                    onPrepareOrder={() => handlePrepareOrder(s)}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredScenarios.map((s) => (
                  <CandidateScenarioRow
                    key={s.id}
                    scenario={s}
                    onReview={() => handleReview(s)}
                    onPrepareOrder={() => handlePrepareOrder(s)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <ComplianceFooter />

      <GoalModeWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onComplete={handleComplete}
      />

      <OrderReviewModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        scenario={activeScenario}
        onSend={handleSend}
      />
    </div>
  );
}
