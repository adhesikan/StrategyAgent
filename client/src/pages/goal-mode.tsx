import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  GoalModeWizard,
  GoalRealityCheck,
  CandidateScenarioCard,
  OrderReviewModal,
  type GoalModePrefs,
  type CandidateScenario,
} from "@/components/goal-mode-shell";
import { BrokerStatusStrip, ComplianceFooter } from "@/components/trading-shell";
import { DailyIdeasSection } from "@/components/daily-ideas-section";
import { Target, RotateCcw } from "lucide-react";
import { HelpLink } from "@/components/help-link";

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
  const [wizardOpen, setWizardOpen] = useState(true);
  const [prefs, setPrefs] = useState<GoalModePrefs | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [activeScenario, setActiveScenario] = useState<CandidateScenario | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("skip") === "1") setWizardOpen(false);
  }, []);

  const handleComplete = (p: GoalModePrefs) => {
    setPrefs(p);
    setWizardOpen(false);
  };

  const handleReview = (s: CandidateScenario) => {
    toast({ title: `${s.ticker} details`, description: s.why });
  };

  const handlePaperTrade = (s: CandidateScenario) => {
    toast({
      title: "Paper trade queued",
      description: `${s.ticker} ${s.strategyType} added to your paper account.`,
    });
  };

  const handlePrepareOrder = (s: CandidateScenario) => {
    setActiveScenario(s);
    setReviewOpen(true);
  };

  const handleSend = () => {
    if (!activeScenario) return;
    toast({
      title: prefs?.brokerConnected ? "Order sent" : "Simulated order placed",
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

      {!prefs && !wizardOpen && (
        <Card data-testid="card-empty-prefs">
          <CardContent className="p-6 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              Run the short questionnaire to see your candidate scenarios.
            </p>
            <Button onClick={() => setWizardOpen(true)} data-testid="button-open-wizard">
              Start questionnaire
            </Button>
          </CardContent>
        </Card>
      )}

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
            <h2 className="text-lg font-semibold mb-3">Candidate Scenarios</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredScenarios.map((s) => (
                <CandidateScenarioCard
                  key={s.id}
                  scenario={s}
                  onReview={() => handleReview(s)}
                  onPaperTrade={() => handlePaperTrade(s)}
                  onPrepareOrder={() => handlePrepareOrder(s)}
                />
              ))}
            </div>
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
        brokerConnected={!!prefs?.brokerConnected}
        onSend={handleSend}
      />
    </div>
  );
}
