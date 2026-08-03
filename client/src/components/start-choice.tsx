import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  LineChart,
  Link2,
  SlidersHorizontal,
  ArrowRight,
  X,
  TrendingUp,
  Wallet,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserTradePreferences } from "@shared/schema";

const PREFS_KEY = ["/api/user/trade-preferences"];

function useTradePrefs() {
  const { user } = useAuth();
  return useQuery<Partial<UserTradePreferences>>({
    queryKey: PREFS_KEY,
    enabled: !!user,
  });
}

function useUpdatePrefs() {
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      await apiRequest("PUT", "/api/user/trade-preferences", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PREFS_KEY });
    },
  });
}

export function StartChoiceDialog() {
  const { data: prefs, isLoading } = useTradePrefs();
  const { user } = useAuth();
  const { data: userSettings, isLoading: settingsLoading } = useQuery<{ setupCompleted?: boolean }>({
    queryKey: ["/api/user/settings"],
    enabled: !!user,
  });
  const [, navigate] = useLocation();
  const update = useUpdatePrefs();
  const [showQuickSetup, setShowQuickSetup] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const open =
    !isLoading &&
    !settingsLoading &&
    !userSettings?.setupCompleted &&
    !dismissed &&
    !showQuickSetup &&
    (!prefs || !prefs.onboardingStatus || prefs.onboardingStatus === "not_started");

  const choose = (status: string, after?: () => void) => {
    setDismissed(true);
    update.mutate({ onboardingStatus: status });
    after?.();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && choose("skipped")}>
        <DialogContent className="max-w-md" data-testid="dialog-start-choice">
          <DialogHeader>
            <DialogTitle>How would you like to begin?</DialogTitle>
            <DialogDescription>
              You can explore market analysis right away — personalization is optional.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Card
              className="cursor-pointer hover-elevate"
              onClick={() => choose("skipped", () => navigate("/market-intel"))}
              data-testid="button-explore-analysis"
            >
              <CardContent className="flex items-center gap-3 p-4">
                <LineChart className="h-5 w-5 text-primary shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Explore Market Analysis</p>
                  <p className="text-xs text-muted-foreground">
                    See AI-generated candidates and market intel in Analysis Mode.
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </CardContent>
            </Card>
            <Card
              className="cursor-pointer hover-elevate"
              onClick={() => choose("skipped", () => navigate("/settings"))}
              data-testid="button-connect-broker-start"
            >
              <CardContent className="flex items-center gap-3 p-4">
                <Link2 className="h-5 w-5 text-primary shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Connect My Broker</p>
                  <p className="text-xs text-muted-foreground">
                    Link your brokerage for live data and order review.
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </CardContent>
            </Card>
            <Card
              className="cursor-pointer hover-elevate"
              onClick={() => setShowQuickSetup(true)}
              data-testid="button-personalize-start"
            >
              <CardContent className="flex items-center gap-3 p-4">
                <SlidersHorizontal className="h-5 w-5 text-primary shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Personalize My Experience</p>
                  <p className="text-xs text-muted-foreground">
                    Answer 3 quick questions to tailor candidate filtering.
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </CardContent>
            </Card>
          </div>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => choose("skipped")}
            data-testid="button-skip-for-now"
          >
            Skip for Now
          </Button>
        </DialogContent>
      </Dialog>
      <QuickSetupDialog
        open={showQuickSetup}
        onClose={() => {
          setShowQuickSetup(false);
          setDismissed(true);
        }}
      />
    </>
  );
}

export function QuickSetupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const update = useUpdatePrefs();
  const [goal, setGoal] = useState<"growth" | "income" | "both">("both");
  const [instruments, setInstruments] = useState<"stocks" | "options" | "both">("both");
  const [risk, setRisk] = useState("500");

  const save = () => {
    update.mutate({
      onboardingStatus: "quick_setup",
      quickSetupCompleted: true,
      preferredGoal: goal,
      preferredInstruments: instruments,
      preferredRiskAmount: Math.max(0, parseFloat(risk) || 0),
    });
    onClose();
  };

  const optionCard = (
    selected: boolean,
    label: string,
    Icon: typeof TrendingUp,
    onClick: () => void,
    testId: string,
  ) => (
    <Card
      key={testId}
      className={cn(
        "cursor-pointer",
        selected ? "border-primary bg-primary/5" : "hover-elevate",
      )}
      onClick={onClick}
      data-testid={testId}
    >
      <CardContent className="flex flex-col items-center gap-1.5 p-3">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium">{label}</span>
      </CardContent>
    </Card>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="dialog-quick-setup">
        <DialogHeader>
          <DialogTitle>Quick Setup</DialogTitle>
          <DialogDescription>
            Three quick questions to make candidates more relevant. You can change these anytime in Settings.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label>What are you primarily interested in?</Label>
            <div className="grid grid-cols-3 gap-2">
              {optionCard(goal === "growth", "Growth", TrendingUp, () => setGoal("growth"), "option-goal-growth")}
              {optionCard(goal === "income", "Income", Wallet, () => setGoal("income"), "option-goal-income")}
              {optionCard(goal === "both", "Both", Layers, () => setGoal("both"), "option-goal-both")}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Preferred instruments</Label>
            <div className="grid grid-cols-3 gap-2">
              {optionCard(instruments === "stocks", "Stocks", LineChart, () => setInstruments("stocks"), "option-instr-stocks")}
              {optionCard(instruments === "options", "Options", SlidersHorizontal, () => setInstruments("options"), "option-instr-options")}
              {optionCard(instruments === "both", "Both", Layers, () => setInstruments("both"), "option-instr-both")}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="quick-risk">Preferred maximum risk per trade ($)</Label>
            <Input
              id="quick-risk"
              type="number"
              min="0"
              value={risk}
              onChange={(e) => setRisk(e.target.value)}
              data-testid="input-quick-risk"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose} data-testid="button-quick-setup-cancel">
            Cancel
          </Button>
          <Button className="flex-1" onClick={save} disabled={update.isPending} data-testid="button-quick-setup-save">
            Save Preferences
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PersonalizationPromptCard() {
  const { data: prefs, isLoading } = useTradePrefs();
  const update = useUpdatePrefs();
  const [showQuickSetup, setShowQuickSetup] = useState(false);

  const shouldShow =
    !isLoading &&
    prefs &&
    prefs.onboardingStatus &&
    prefs.onboardingStatus !== "not_started" &&
    !prefs.quickSetupCompleted &&
    !prefs.fullPersonalizationCompleted &&
    !prefs.personalizationDismissed;

  if (!shouldShow) {
    return (
      <QuickSetupDialog open={showQuickSetup} onClose={() => setShowQuickSetup(false)} />
    );
  }

  return (
    <>
      <Card data-testid="card-personalization-prompt">
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Make these ideas more relevant</p>
            <p className="text-xs text-muted-foreground">
              Complete your trading preferences to improve candidate filtering and configure your risk limits.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" onClick={() => setShowQuickSetup(true)} data-testid="button-prompt-quick-setup">
              Quick Setup
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.dispatchEvent(new Event("open-setup-wizard"))}
              data-testid="button-prompt-full-setup"
            >
              Full Setup
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Dismiss personalization prompt"
              onClick={() => update.mutate({ personalizationDismissed: true })}
              data-testid="button-prompt-dismiss"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
      <QuickSetupDialog open={showQuickSetup} onClose={() => setShowQuickSetup(false)} />
    </>
  );
}

export function IncompletePreferencesDisclosure() {
  const { data: prefs, isLoading } = useTradePrefs();
  if (isLoading || prefs?.quickSetupCompleted || prefs?.fullPersonalizationCompleted) return null;
  return (
    <p className="text-xs text-muted-foreground" data-testid="text-incomplete-prefs-disclosure">
      These are general AI-generated market candidates and have not been filtered using your
      complete trading preferences or financial circumstances.
    </p>
  );
}
