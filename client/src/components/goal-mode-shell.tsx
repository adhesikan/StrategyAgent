import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import { useLocation } from "wouter";
import {
  Wallet,
  Target,
  ShieldAlert,
  Activity,
  Layers,
  Link2,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Send,
  X,
} from "lucide-react";

export interface GoalModePrefs {
  capital: number;
  goalType: "monthly_income" | "account_growth" | "lower_risk" | "learn_practice";
  maxRiskPerTrade: number;
  activityLevel: "low" | "moderate" | "active";
  allowedInstruments: string[];
  brokerConnected: boolean;
}

const CAPITAL_CHIPS = [2500, 5000, 10000, 25000];
const RISK_CHIPS = [50, 100, 200, 500];
const GOAL_OPTIONS: { value: GoalModePrefs["goalType"]; label: string; desc: string }[] = [
  { value: "monthly_income", label: "Monthly income", desc: "Premium-collection ideas with defined risk" },
  { value: "account_growth", label: "Account growth", desc: "Risk-aware directional and trend setups" },
  { value: "lower_risk", label: "Lower-risk ideas", desc: "Smaller position sizes, defined-risk only" },
  { value: "learn_practice", label: "Learn and practice", desc: "Paper-mode scenarios with explanations" },
];
const INSTRUMENT_OPTIONS = [
  "Stocks",
  "Covered calls",
  "Cash-secured puts",
  "Long calls/puts",
  "Debit spreads",
  "Credit spreads",
];
const ACTIVITY_OPTIONS: { value: GoalModePrefs["activityLevel"]; label: string; desc: string }[] = [
  { value: "low", label: "Low activity", desc: "A few ideas per week" },
  { value: "moderate", label: "Moderate", desc: "Daily ideas during market hours" },
  { value: "active", label: "Active", desc: "Frequent intraday and swing ideas" },
];

interface GoalModeWizardProps {
  open: boolean;
  onClose: () => void;
  onComplete: (prefs: GoalModePrefs) => void;
}

const TOTAL = 6;

export function GoalModeWizard({ open, onClose, onComplete }: GoalModeWizardProps) {
  const { isConnected } = useBrokerStatus();
  const [step, setStep] = useState(0);
  const [capital, setCapital] = useState<number>(5000);
  const [customCapital, setCustomCapital] = useState<string>("");
  const [goalType, setGoalType] = useState<GoalModePrefs["goalType"]>("account_growth");
  const [risk, setRisk] = useState<number>(100);
  const [customRisk, setCustomRisk] = useState<string>("");
  const [activity, setActivity] = useState<GoalModePrefs["activityLevel"]>("moderate");
  const [instruments, setInstruments] = useState<string[]>(["Stocks", "Covered calls"]);

  const finishWith = (brokerConnected: boolean) => {
    const finalCapital = customCapital ? parseInt(customCapital, 10) || capital : capital;
    const finalRisk = customRisk ? parseInt(customRisk, 10) || risk : risk;
    onComplete({
      capital: finalCapital,
      goalType,
      maxRiskPerTrade: finalRisk,
      activityLevel: activity,
      allowedInstruments: instruments,
      brokerConnected,
    });
    setStep(0);
  };

  const next = () => setStep((s) => Math.min(s + 1, TOTAL - 1));
  const prev = () => setStep((s) => Math.max(s - 1, 0));
  const progress = ((step + 1) / TOTAL) * 100;

  const toggleInstrument = (name: string) => {
    setInstruments((prev) =>
      prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name],
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="dialog-goal-wizard">
        <DialogHeader>
          <DialogTitle data-testid="text-goal-wizard-title">Set your goal</DialogTitle>
          <DialogDescription data-testid="text-goal-wizard-step">
            Step {step + 1} of {TOTAL} — answer a few questions and we'll build candidate scenarios.
          </DialogDescription>
        </DialogHeader>
        <Progress value={progress} className="h-1.5" />

        <div className="py-4 min-h-[260px]">
          {step === 0 && (
            <div className="space-y-4" data-testid="step-capital">
              <div className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-blue-400" />
                <h3 className="font-semibold">How much capital do you want to work with?</h3>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {CAPITAL_CHIPS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setCapital(c);
                      setCustomCapital("");
                    }}
                    data-testid={`chip-capital-${c}`}
                    className={`rounded-lg border px-3 py-3 text-sm font-medium transition-colors ${
                      capital === c && !customCapital
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover-elevate"
                    }`}
                  >
                    ${c.toLocaleString()}
                  </button>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="custom-capital" className="text-xs">Or enter a custom amount</Label>
                <Input
                  id="custom-capital"
                  type="number"
                  inputMode="numeric"
                  placeholder="e.g. 7500"
                  value={customCapital}
                  onChange={(e) => setCustomCapital(e.target.value)}
                  data-testid="input-custom-capital"
                />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4" data-testid="step-goal">
              <div className="flex items-center gap-2">
                <Target className="h-5 w-5 text-emerald-400" />
                <h3 className="font-semibold">What is your primary goal?</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {GOAL_OPTIONS.map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => setGoalType(g.value)}
                    data-testid={`option-goal-${g.value}`}
                    className={`text-left rounded-lg border p-3 transition-colors ${
                      goalType === g.value
                        ? "border-primary bg-primary/10"
                        : "border-border hover-elevate"
                    }`}
                  >
                    <div className="font-medium text-sm">{g.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{g.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4" data-testid="step-risk">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-amber-400" />
                <h3 className="font-semibold">What is your max risk per trade?</h3>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {RISK_CHIPS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      setRisk(r);
                      setCustomRisk("");
                    }}
                    data-testid={`chip-risk-${r}`}
                    className={`rounded-lg border px-3 py-3 text-sm font-medium transition-colors ${
                      risk === r && !customRisk
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover-elevate"
                    }`}
                  >
                    ${r}
                  </button>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="custom-risk" className="text-xs">Or enter a custom max risk</Label>
                <Input
                  id="custom-risk"
                  type="number"
                  inputMode="numeric"
                  placeholder="e.g. 150"
                  value={customRisk}
                  onChange={(e) => setCustomRisk(e.target.value)}
                  data-testid="input-custom-risk"
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4" data-testid="step-activity">
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-violet-400" />
                <h3 className="font-semibold">How active do you want to be?</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {ACTIVITY_OPTIONS.map((a) => (
                  <button
                    key={a.value}
                    type="button"
                    onClick={() => setActivity(a.value)}
                    data-testid={`option-activity-${a.value}`}
                    className={`text-left rounded-lg border p-3 transition-colors ${
                      activity === a.value
                        ? "border-primary bg-primary/10"
                        : "border-border hover-elevate"
                    }`}
                  >
                    <div className="font-medium text-sm">{a.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{a.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4" data-testid="step-instruments">
              <div className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-blue-400" />
                <h3 className="font-semibold">What instruments are you comfortable with?</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {INSTRUMENT_OPTIONS.map((name) => {
                  const checked = instruments.includes(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => toggleInstrument(name)}
                      data-testid={`option-instrument-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                      className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                        checked ? "border-primary bg-primary/10" : "border-border hover-elevate"
                      }`}
                    >
                      <Checkbox checked={checked} className="pointer-events-none" />
                      <span className="text-sm font-medium">{name}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                We'll only show scenarios that match what you've selected.
              </p>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4" data-testid="step-broker">
              <div className="flex items-center gap-2">
                <Link2 className="h-5 w-5 text-emerald-400" />
                <h3 className="font-semibold">Broker connection</h3>
              </div>
              {isConnected ? (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4 flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400 mt-0.5" />
                  <div className="text-sm">
                    <div className="font-medium">Broker is connected.</div>
                    <p className="text-muted-foreground mt-1">
                      We'll show live market data. Orders are only sent after you review and confirm them.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
                  <p>
                    You can explore scenarios in <strong>simulated mode</strong> now. Connect your broker
                    later for live market data and self-directed order entry.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-row justify-between sm:justify-between gap-2">
          <Button
            variant="ghost"
            onClick={prev}
            disabled={step === 0}
            data-testid="button-goal-back"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>

          {step < TOTAL - 1 ? (
            <Button onClick={next} data-testid="button-goal-next">
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => finishWith(false)}
                data-testid="button-goal-simulated"
              >
                Continue in Simulated Mode
              </Button>
              {!isConnected && (
                <Button
                  onClick={() => {
                    onClose();
                    window.location.href = "/settings";
                  }}
                  data-testid="button-goal-connect-broker"
                >
                  Connect Broker
                </Button>
              )}
              {isConnected && (
                <Button onClick={() => finishWith(true)} data-testid="button-goal-finish-connected">
                  Show My Scenarios
                </Button>
              )}
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface GoalRealityCheckProps {
  prefs: GoalModePrefs;
  monthlyTarget?: number;
}

export function GoalRealityCheck({ prefs, monthlyTarget }: GoalRealityCheckProps) {
  const target = monthlyTarget ?? Math.round(prefs.capital * 0.04);
  const requiredReturnPct = prefs.capital > 0 ? (target / prefs.capital) * 100 : 0;
  const aggressive = requiredReturnPct > 5;
  const riskLevel: "Conservative" | "Moderate" | "Aggressive" =
    requiredReturnPct < 2 ? "Conservative" : requiredReturnPct < 5 ? "Moderate" : "Aggressive";

  const realityText = `Your goal of approximately $${target.toLocaleString()}/month on $${prefs.capital.toLocaleString()} requires roughly ${requiredReturnPct.toFixed(
    1,
  )}% monthly before fees and slippage.${
    aggressive ? " That may be aggressive depending on market conditions." : ""
  } VCP Trader AI will show risk-defined scenarios for review, not guaranteed outcomes.`;

  return (
    <Card data-testid="card-reality-check" className="border-amber-500/30 bg-amber-500/5">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          Goal Reality Check
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed text-muted-foreground" data-testid="text-reality-check">
          {realityText}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          <Stat label="Capital" value={`$${prefs.capital.toLocaleString()}`} />
          <Stat label="Goal" value={GOAL_OPTIONS.find((g) => g.value === prefs.goalType)?.label ?? "—"} />
          <Stat label="Max risk / trade" value={`$${prefs.maxRiskPerTrade}`} />
          <Stat label="Activity level" value={prefs.activityLevel} capitalize />
          <Stat
            label="Risk level"
            value={riskLevel}
            valueClass={
              riskLevel === "Aggressive"
                ? "text-red-400"
                : riskLevel === "Moderate"
                  ? "text-amber-400"
                  : "text-emerald-400"
            }
          />
          <Stat label="Realistic range" value={`${(requiredReturnPct * 0.4).toFixed(1)}%–${requiredReturnPct.toFixed(1)}%/mo`} />
        </div>
        <div className="flex flex-wrap gap-1.5" data-testid="reality-instruments">
          {prefs.allowedInstruments.map((i) => (
            <Badge key={i} variant="outline" className="text-[10px]">
              {i}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  valueClass,
  capitalize,
}: {
  label: string;
  value: string;
  valueClass?: string;
  capitalize?: boolean;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${capitalize ? "capitalize" : ""} ${valueClass ?? ""}`}>{value}</div>
    </div>
  );
}

export interface CandidateScenario {
  id: string;
  ticker: string;
  strategyType: string;
  bias: "Bullish" | "Bearish" | "Neutral";
  capitalRequired: number;
  maxLoss: number;
  maxGain: number;
  breakeven: number;
  probabilityGrade: "A+" | "A" | "B" | "C";
  liquidity: "High" | "Medium" | "Low";
  why: string;
  risks: string[];
}

interface CandidateScenarioCardProps {
  scenario: CandidateScenario;
  onReview: () => void;
  onPrepareOrder: () => void;
}

const GRADE_COLORS: Record<string, string> = {
  "A+": "bg-emerald-500/20 text-emerald-400 border-emerald-500/40",
  A: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  B: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  C: "bg-amber-500/15 text-amber-400 border-amber-500/30",
};

export function CandidateScenarioCard({ scenario, onReview, onPrepareOrder }: CandidateScenarioCardProps) {
  return (
    <Card
      data-testid={`card-scenario-${scenario.id}`}
      className="hover-elevate transition-all"
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold" data-testid={`text-ticker-${scenario.id}`}>
                {scenario.ticker}
              </span>
              <Badge variant="outline" className="text-[10px]">
                {scenario.strategyType}
              </Badge>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <TrendingUp className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">{scenario.bias}</span>
            </div>
          </div>
          <Badge className={`text-xs font-semibold ${GRADE_COLORS[scenario.probabilityGrade]}`} data-testid={`badge-grade-${scenario.id}`}>
            Grade {scenario.probabilityGrade}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Mini label="Capital" value={`$${scenario.capitalRequired.toLocaleString()}`} />
          <Mini label="Max loss" value={`$${scenario.maxLoss.toLocaleString()}`} className="text-red-400" />
          <Mini label="Max gain" value={`$${scenario.maxGain.toLocaleString()}`} className="text-emerald-400" />
          <Mini label="Breakeven" value={`$${scenario.breakeven.toFixed(2)}`} />
        </div>

        <div className="text-xs">
          <Badge variant="outline" className="text-[10px]">
            Liquidity: {scenario.liquidity}
          </Badge>
        </div>

        <div className="text-xs">
          <div className="font-medium mb-1">Why this scenario appeared</div>
          <p className="text-muted-foreground leading-snug">{scenario.why}</p>
        </div>

        <div className="text-xs">
          <div className="font-medium mb-1">Main risks</div>
          <ul className="text-muted-foreground space-y-0.5 list-disc list-inside">
            {scenario.risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 pt-2">
          <Button size="sm" variant="outline" onClick={onReview} data-testid={`button-review-${scenario.id}`}>
            Review Details
          </Button>
          <Button size="sm" onClick={onPrepareOrder} data-testid={`button-prepare-${scenario.id}`}>
            Prepare Order
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Mini({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded border border-border/60 bg-muted/30 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-semibold ${className ?? ""}`}>{value}</div>
    </div>
  );
}

interface OrderReviewModalProps {
  open: boolean;
  onClose: () => void;
  scenario: CandidateScenario | null;
  /** @deprecated Read live status from useBrokerStatus() — prop is ignored. */
  brokerConnected?: boolean;
  onSend: () => void;
}

export function OrderReviewModal({ open, onClose, scenario, onSend }: OrderReviewModalProps) {
  // Always read live broker status from the shared hook so the submit button
  // reflects the actual connection state shown in BrokerStatusStrip.
  const { isConnected: brokerConnected } = useBrokerStatus();
  const [acknowledged, setAcknowledged] = useState(false);

  if (!scenario) return null;

  const handleClose = () => {
    setAcknowledged(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-xl" data-testid="dialog-order-review">
        <DialogHeader>
          <DialogTitle data-testid="text-order-review-title">Review Before Sending</DialogTitle>
          <DialogDescription>
            Confirm every detail. No order is sent until you click {brokerConnected ? "Send to Broker" : "Connect Broker"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg border bg-muted/20 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-lg">{scenario.ticker}</span>
              <Badge variant="outline">{scenario.strategyType}</Badge>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs pt-2">
              <Mini label="Bias" value={scenario.bias} />
              <Mini label="Capital" value={`$${scenario.capitalRequired.toLocaleString()}`} />
              <Mini label="Max loss" value={`$${scenario.maxLoss.toLocaleString()}`} className="text-red-400" />
              <Mini label="Max gain" value={`$${scenario.maxGain.toLocaleString()}`} className="text-emerald-400" />
              <Mini label="Breakeven" value={`$${scenario.breakeven.toFixed(2)}`} />
              <Mini label="Liquidity" value={scenario.liquidity} />
            </div>
          </div>

          {scenario.liquidity === "Low" && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs flex gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <span>Liquidity is low. Slippage and fill quality may be poor.</span>
            </div>
          )}

          <label className="flex items-start gap-2 cursor-pointer text-sm" data-testid="label-acknowledge">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(v) => setAcknowledged(!!v)}
              data-testid="checkbox-acknowledge"
            />
            <span className="leading-snug">
              I understand this is a self-directed order and not investment advice.
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} data-testid="button-order-cancel">
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
          {brokerConnected ? (
            <Button
              disabled={!acknowledged}
              onClick={() => {
                onSend();
                handleClose();
              }}
              data-testid="button-order-send"
            >
              <Send className="h-4 w-4 mr-1" />
              Send to Broker
            </Button>
          ) : (
            <Button
              onClick={() => {
                handleClose();
                window.location.href = "/settings";
              }}
              data-testid="button-order-connect"
            >
              <Link2 className="h-4 w-4 mr-1" />
              Connect Broker to Use InstaTrade
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
