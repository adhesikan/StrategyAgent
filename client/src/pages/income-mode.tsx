import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { BrokerStatusStrip, ComplianceFooter } from "@/components/trading-shell";
import { CandidateScenarioCard, CandidateScenarioRow, OrderReviewModal, type CandidateScenario } from "@/components/goal-mode-shell";
import { DailyIdeasSection } from "@/components/daily-ideas-section";
import { DollarSign, AlertTriangle, Sparkles } from "lucide-react";
import { ViewToggle, type ViewMode } from "@/components/view-toggle";
import { HelpLink } from "@/components/help-link";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import { HowToUseSection } from "@/components/how-to-use-section";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type IncomeUniverseId = "watchlist" | "large_cap" | "high_volume" | "options_liquid" | "custom";

const INCOME_IDEAS: CandidateScenario[] = [
  {
    id: "inc-1",
    ticker: "MSFT",
    strategyType: "Covered Call (30d)",
    bias: "Neutral",
    capitalRequired: 41200,
    maxLoss: 41200,
    maxGain: 580,
    breakeven: 408.2,
    probabilityGrade: "A+",
    liquidity: "High",
    why: "MSFT is range-bound near a known supply zone. 30d call premiums are above 30d average IV.",
    risks: ["Upside capped above strike", "Standard equity downside exposure"],
  },
  {
    id: "inc-2",
    ticker: "KO",
    strategyType: "Cash-Secured Put",
    bias: "Neutral",
    capitalRequired: 5900,
    maxLoss: 5900,
    maxGain: 78,
    breakeven: 58.78,
    probabilityGrade: "A",
    liquidity: "High",
    why: "KO has been consolidating. Selling a slightly OTM put earns income with a known assignment price.",
    risks: ["Assignment risk if KO drops below strike at expiry", "Capital tied up for ~30 days"],
  },
  {
    id: "inc-3",
    ticker: "META",
    strategyType: "Bull Put Spread",
    bias: "Bullish",
    capitalRequired: 320,
    maxLoss: 320,
    maxGain: 180,
    breakeven: 568.2,
    probabilityGrade: "B",
    liquidity: "High",
    why: "META is holding above a major moving average. Defined-risk credit spread targets time decay.",
    risks: ["Max loss if META falls through both strikes", "Spread can widen with volatility spikes"],
  },
];

export default function IncomeModePage() {
  const { toast } = useToast();
  const [capital, setCapital] = useState("25000");
  const [target, setTarget] = useState("500");
  const [maxRisk, setMaxRisk] = useState("200");
  const [universe, setUniverse] = useState<IncomeUniverseId>("watchlist");
  const [customTickers, setCustomTickers] = useState("AAPL, MSFT, KO, SPY");
  const [avoidEarnings, setAvoidEarnings] = useState(true);
  const [minVolume, setMinVolume] = useState("100");
  const [minOI, setMinOI] = useState("500");
  const [maxSpread, setMaxSpread] = useState("0.10");
  const [showIdeas, setShowIdeas] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [activeScenario, setActiveScenario] = useState<CandidateScenario | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("card");

  const { isConnected: brokerConnected } = useBrokerStatus();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowIdeas(true);
  };

  const handleReview = (s: CandidateScenario) => {
    setActiveScenario(s);
    setReviewOpen(true);
  };

  const handlePrepareOrder = (s: CandidateScenario) => {
    setActiveScenario(s);
    setReviewOpen(true);
  };

  const handleSend = () => {
    if (!activeScenario) return;
    toast({
      title: brokerConnected ? "Sent to broker via InstaTrade™" : "Simulated order placed",
      description: `${activeScenario.ticker} ${activeScenario.strategyType} submitted for review.`,
    });
  };

  return (
    <div className="flex-1 p-4 md:p-6 max-w-6xl mx-auto w-full space-y-6">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <DollarSign className="h-6 w-6 text-emerald-400" />
            Income
          </h1>
          <HelpLink section="income" />
        </div>
        <p className="text-sm text-muted-foreground">
          Explore stock and options income opportunities with defined risk.
        </p>
      </div>

      <BrokerStatusStrip />

      <HowToUseSection
        testIdSlug="income"
        steps={[
          { title: "Set income parameters", detail: "Enter your capital, monthly income target, and max risk per trade. We filter for income-style strategies that fit." },
          { title: "Pick your symbol pool", detail: "Choose your watchlist, large caps, options-liquid names, or paste custom symbols." },
          { title: "Review candidate income trades", detail: "Each shows premium, breakeven, and max loss. Hover any field for an explanation in plain English." },
          { title: "Prepare an order", detail: "Click Prepare Order to see the full review modal — nothing is sent until you acknowledge and confirm." },
        ]}
      />

      <DailyIdeasSection
        bucket="income"
        title="Today's Income Ideas"
        subtitle="Covered calls, cash-secured puts, and defined-risk income setups."
        limit={6}
      />

      <Card data-testid="card-income-form">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-400" />
            Build my income search
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field id="capital" label="Capital available">
              <Input
                id="capital"
                type="number"
                inputMode="numeric"
                value={capital}
                onChange={(e) => setCapital(e.target.value)}
                data-testid="input-capital"
              />
            </Field>
            <Field id="target" label="Desired monthly income">
              <Input
                id="target"
                type="number"
                inputMode="numeric"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                data-testid="input-target"
              />
            </Field>
            <Field id="risk" label="Max risk per trade">
              <Input
                id="risk"
                type="number"
                inputMode="numeric"
                value={maxRisk}
                onChange={(e) => setMaxRisk(e.target.value)}
                data-testid="input-max-risk"
              />
            </Field>
            <Field id="tickers" label="Preferred tickers / watchlist">
              <Select value={universe} onValueChange={(v) => setUniverse(v as IncomeUniverseId)}>
                <SelectTrigger id="tickers" data-testid="select-tickers">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="watchlist">Watchlist</SelectItem>
                  <SelectItem value="large_cap">Large cap</SelectItem>
                  <SelectItem value="high_volume">High volume</SelectItem>
                  <SelectItem value="options_liquid">Options liquid</SelectItem>
                  <SelectItem value="custom">Custom symbols</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {universe === "custom" && (
              <Field id="custom-tickers" label="Custom symbols (comma-separated)">
                <Input
                  id="custom-tickers"
                  value={customTickers}
                  onChange={(e) => setCustomTickers(e.target.value)}
                  placeholder="AAPL, MSFT, NVDA"
                  data-testid="input-custom-tickers"
                />
              </Field>
            )}

            <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field id="vol" label="Min option volume">
                <Input
                  id="vol"
                  type="number"
                  value={minVolume}
                  onChange={(e) => setMinVolume(e.target.value)}
                  data-testid="input-min-volume"
                />
              </Field>
              <Field id="oi" label="Min open interest">
                <Input
                  id="oi"
                  type="number"
                  value={minOI}
                  onChange={(e) => setMinOI(e.target.value)}
                  data-testid="input-min-oi"
                />
              </Field>
              <Field id="spread" label="Max bid/ask spread ($)">
                <Input
                  id="spread"
                  type="number"
                  step="0.01"
                  value={maxSpread}
                  onChange={(e) => setMaxSpread(e.target.value)}
                  data-testid="input-max-spread"
                />
              </Field>
            </div>

            <div className="md:col-span-2 flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">Avoid earnings within window</div>
                <div className="text-xs text-muted-foreground">Skip tickers with upcoming earnings during the trade.</div>
              </div>
              <Switch
                checked={avoidEarnings}
                onCheckedChange={setAvoidEarnings}
                data-testid="switch-avoid-earnings"
              />
            </div>

            <div className="md:col-span-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs flex gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
              <span>
                <strong>Reality check:</strong> Income targets are not guaranteed. Higher premium usually
                comes with higher risk.
              </span>
            </div>

            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" data-testid="button-find-income">
                Find income ideas
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {showIdeas && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-lg font-semibold">Candidate Income Scenarios</h2>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="text-xs">
                ${target}/mo target on ${parseInt(capital, 10).toLocaleString()} capital
              </Badge>
              <ViewToggle value={viewMode} onChange={setViewMode} testId="view-toggle-income" />
            </div>
          </div>
          {viewMode === "card" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {INCOME_IDEAS.map((s) => (
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
              {INCOME_IDEAS.map((s) => (
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
      )}

      <ComplianceFooter />

      <OrderReviewModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        scenario={activeScenario}
        onSend={handleSend}
      />
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
