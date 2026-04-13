import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { 
  X, ChevronRight, ChevronLeft, Play, BookOpen, 
  TrendingUp, Search, Bell, Zap, Target, BarChart3,
  CheckCircle2, ArrowRight, ScanLine, DollarSign, Shield
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface TutorialStep {
  id: string;
  title: string;
  content: string;
  icon?: any;
  image?: string;
  tips?: string[];
}

interface Tutorial {
  id: string;
  title: string;
  description: string;
  icon: any;
  steps: TutorialStep[];
  settingsKey: string;
}

const VCP_TUTORIAL: Tutorial = {
  id: "vcp",
  title: "Understanding VCP Patterns",
  description: "Learn how Volatility Contraction Patterns signal powerful breakout opportunities",
  icon: TrendingUp,
  settingsKey: "hasSeenVcpTutorial",
  steps: [
    {
      id: "vcp-intro",
      title: "What is a VCP?",
      content: "The Volatility Contraction Pattern (VCP) is one of the most reliable chart patterns for identifying stocks ready to break out. It shows a stock consolidating with decreasing volatility, building energy for a significant move.",
      icon: TrendingUp,
      tips: [
        "VCPs typically form over 3-7 weeks",
        "Look for 2-4 contractions in price range",
        "Volume should dry up as the pattern matures"
      ]
    },
    {
      id: "vcp-stages",
      title: "Pattern Stages",
      content: "Strategy Agent tracks three key stages: FORMING (pattern developing, volatility contracting), READY (pattern mature, approaching breakout point), and BREAKOUT (price breaking above resistance with volume).",
      icon: Target,
      tips: [
        "FORMING: Pattern building, not yet ready to trade",
        "READY: Watch closely for entry opportunity",
        "BREAKOUT: Entry signal confirmed with volume"
      ]
    },
    {
      id: "vcp-resistance",
      title: "Key Levels: Resistance & Stop",
      content: "Each scan result shows auto-calculated Resistance (the breakout level) and Stop Loss levels. Resistance is the price that must be broken with volume. Stop Loss is typically placed below the most recent low of the pattern.",
      icon: BarChart3,
      tips: [
        "Buy on breakout above resistance with strong volume",
        "Set stop loss at the suggested level",
        "Risk/reward should be at least 2:1"
      ]
    },
    {
      id: "vcp-volume",
      title: "Volume Confirmation",
      content: "The RVOL (Relative Volume) indicator shows how current volume compares to the 50-day average. A breakout should have RVOL of 1.5x or higher to confirm institutional buying.",
      icon: Zap,
      tips: [
        "RVOL > 1.5 = strong volume confirmation",
        "RVOL > 2.0 = exceptional institutional interest",
        "Low volume breakouts often fail"
      ]
    },
    {
      id: "vcp-action",
      title: "Taking Action",
      content: "When you find a READY or BREAKOUT pattern: 1) Review the chart to confirm the setup, 2) Set price alerts near resistance, 3) Wait for volume confirmation before entering, 4) Use the calculated stop loss level.",
      icon: CheckCircle2,
      tips: [
        "Never chase extended breakouts",
        "Wait for proper setup, don't force trades",
        "Manage position size based on stop distance"
      ]
    }
  ]
};

const SCANNER_TUTORIAL: Tutorial = {
  id: "scanner",
  title: "Using the Scanner",
  description: "Master the scanner to find the best trading setups",
  icon: Search,
  settingsKey: "hasSeenScannerTutorial",
  steps: [
    {
      id: "scanner-modes",
      title: "Engine Modes",
      content: "Choose between Single Strategy (focus on one pattern type) or Fusion Mode (scan across all 9 strategies to find stocks appearing in multiple scans, indicating stronger setups).",
      icon: Search,
      tips: [
        "Single: Best for mastering one strategy",
        "Fusion: Find high-conviction multi-signal setups",
        "Start with Single to learn each strategy"
      ]
    },
    {
      id: "scanner-strategies",
      title: "9 Trading Strategies",
      content: "Strategy Agent includes strategies across 4 categories: Momentum (VCP, Classic Pullback), Trend (Gap & Go, Trend Continuation), Volatility (Volatility Squeeze, High RVOL), and Intraday (ORB 5min, ORB 15min, VWAP Reclaim).",
      icon: Zap,
      tips: [
        "VCP is the flagship momentum strategy",
        "Intraday strategies work for day trading",
        "Use Strategy Guide for detailed explanations"
      ]
    },
    {
      id: "scanner-targets",
      title: "Scan Targets",
      content: "Choose what to scan: Watchlist (your saved symbols), Single Symbol (analyze one stock), or Market Universe (scan Dow 30, Nasdaq 100, S&P 500, or all US stocks).",
      icon: Target,
      tips: [
        "Watchlist is fastest for focused analysis",
        "Universe scans find new opportunities",
        "Market scans require connected broker"
      ]
    },
    {
      id: "scanner-filters",
      title: "Filter Presets",
      content: "Use presets to quickly configure filters: Balanced (default), Conservative (lower risk), Aggressive (more signals), Scalp (high volume quick trades), or Swing (multi-day holds).",
      icon: BarChart3,
      tips: [
        "Start with Balanced preset",
        "Expand Advanced for fine-tuning",
        "Filters apply to all scan results"
      ]
    },
    {
      id: "scanner-results",
      title: "Understanding Results",
      content: "Scan results show Pattern Score (quality rating), Stage (FORMING/READY/BREAKOUT), RVOL (volume confirmation), and key price levels. Click any row to view the detailed chart.",
      icon: CheckCircle2,
      tips: [
        "Sort by Pattern Score to find best setups",
        "Focus on READY stage for entries",
        "Higher RVOL = stronger confirmation"
      ]
    }
  ]
};

const ALERTS_TUTORIAL: Tutorial = {
  id: "alerts",
  title: "Setting Up Alerts",
  description: "Never miss a trading opportunity with real-time notifications",
  icon: Bell,
  settingsKey: "hasSeenAlertsTutorial",
  steps: [
    {
      id: "alerts-types",
      title: "Alert Types",
      content: "Strategy Agent offers 4 alert types: BREAKOUT (price crosses resistance), STOP HIT (price falls below stop), EMA EXIT (trend reversal signal), and APPROACHING (price nearing key level).",
      icon: Bell,
      tips: [
        "BREAKOUT alerts trigger entry signals",
        "STOP HIT alerts protect your capital",
        "APPROACHING gives early warning"
      ]
    },
    {
      id: "alerts-push",
      title: "Push Notifications",
      content: "Enable push notifications to receive alerts on your phone or desktop even when the app is closed. Go to Settings to enable and grant browser notification permissions.",
      icon: Zap,
      tips: [
        "Works on mobile with PWA install",
        "Requires browser notification permission",
        "Alerts work even when app is backgrounded"
      ]
    },
    {
      id: "alerts-manage",
      title: "Managing Alerts",
      content: "View all alerts from the Alerts page in the sidebar. Mark alerts as read, dismiss them, or click to view the chart. Unread alert count shows in the navigation badge.",
      icon: CheckCircle2,
      tips: [
        "Review triggered alerts promptly",
        "Clear old alerts regularly",
        "Set alerts from chart view or watchlist"
      ]
    }
  ]
};

const OPTIONS_TUTORIAL: Tutorial = {
  id: "options",
  title: "Options Scanner Strategies",
  description: "Learn how the Options Scanner identifies and ranks trade ideas across multiple strategies",
  icon: ScanLine,
  settingsKey: "hasSeenOptionsTutorial",
  steps: [
    {
      id: "options-overview",
      title: "What the Options Scanner Does",
      content: "The Options Scanner searches hundreds of stocks at once to find the best options trade ideas for your chosen strategy. It filters by your preferences (expiration, delta, premium) and ranks results by a composite score so the top picks appear first.",
      icon: ScanLine,
      tips: [
        "Choose a strategy, pick your stock universe, then hit Find Trades",
        "Results are ranked so the best ideas are at the top",
        "Switch between Card view for details or List view for quick scanning"
      ]
    },
    {
      id: "options-long",
      title: "Long Options (Calls & Puts)",
      content: "The simplest strategy: buy a call if you think a stock will go up, or a put if you think it will go down. Your maximum loss is limited to what you paid for the option (the premium). The scanner finds options with good implied volatility, adequate liquidity, and strikes slightly out-of-the-money for the best risk/reward.",
      icon: TrendingUp,
      tips: [
        "Long Call = bullish bet, Long Put = bearish bet",
        "Max loss is the premium you pay, max gain can be much larger",
        "Scanner favors options with high open interest for easy entry and exit",
        "Higher delta = more expensive but higher chance of profit"
      ]
    },
    {
      id: "options-wheel",
      title: "Wheel Strategy (Income)",
      content: "An income-generating strategy with two variants. Cash-Secured Put: you sell puts on stocks you want to own, collecting premium while you wait. If assigned, you buy the stock at a discount. Covered Call: you sell calls on stock you already hold, earning income while you wait. The scanner finds the best premium opportunities across your chosen stocks.",
      icon: DollarSign,
      tips: [
        "Cash-Secured Put: get paid to wait for stocks at a lower price",
        "Covered Call: earn income on stocks you already own",
        "Best for high-quality stocks you would hold long-term",
        "Scanner ranks by annualized premium return vs. capital required"
      ]
    },
    {
      id: "options-spreads",
      title: "Credit Spreads (Defined Risk)",
      content: "Credit spreads let you collect premium with a defined maximum loss. Bull Put Spread: sell a put and buy a lower put (bullish). Bear Call Spread: sell a call and buy a higher call (bearish). Both strategies profit when the stock stays in your expected range. The scanner finds spreads with the best probability of profit relative to the premium collected.",
      icon: Shield,
      tips: [
        "Bull Put Spread = bullish, Bear Call Spread = bearish",
        "Both max profit and max loss are known before you enter",
        "Wider spread = more premium but more risk",
        "Scanner ranks by probability of profit (PoP) and risk/reward ratio"
      ]
    },
    {
      id: "options-preferences",
      title: "Scan Preferences & Metrics",
      content: "Customize your scans with three key filters: Days to Expiration (DTE) controls how far out the options expire, Delta Range controls how far in/out-of-the-money the strikes are, and Min Premium % sets the minimum income threshold. Key metrics on each result: IV (implied volatility), PoP (probability of profit), Max Profit/Loss, and Breakeven price.",
      icon: Target,
      tips: [
        "DTE 14-45 days is the sweet spot for most strategies",
        "Lower delta = cheaper options but lower win rate",
        "Higher min premium = fewer results but better income potential",
        "Score combines multiple factors to rank the best opportunities"
      ]
    }
  ]
};

export const TUTORIALS = [VCP_TUTORIAL, SCANNER_TUTORIAL, ALERTS_TUTORIAL, OPTIONS_TUTORIAL];

interface InteractiveTutorialProps {
  tutorialId?: string;
  isOpen: boolean;
  onClose: () => void;
  onComplete?: () => void;
}

export function InteractiveTutorial({ tutorialId, isOpen, onClose, onComplete }: InteractiveTutorialProps) {
  const [currentTutorial, setCurrentTutorial] = useState<Tutorial | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [showTutorialList, setShowTutorialList] = useState(!tutorialId);

  useEffect(() => {
    if (tutorialId) {
      const tutorial = TUTORIALS.find(t => t.id === tutorialId);
      if (tutorial) {
        setCurrentTutorial(tutorial);
        setShowTutorialList(false);
      }
    } else {
      setShowTutorialList(true);
    }
  }, [tutorialId]);

  const updateSettingsMutation = useMutation({
    mutationFn: async (updates: Record<string, boolean>) => {
      await apiRequest("PATCH", "/api/user/settings", updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
    },
  });

  const handleSelectTutorial = (tutorial: Tutorial) => {
    setCurrentTutorial(tutorial);
    setCurrentStep(0);
    setShowTutorialList(false);
  };

  const handleNext = () => {
    if (currentTutorial && currentStep < currentTutorial.steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = () => {
    if (currentTutorial) {
      updateSettingsMutation.mutate({ [currentTutorial.settingsKey]: true });
    }
    if (onComplete) {
      onComplete();
    }
    setShowTutorialList(true);
    setCurrentTutorial(null);
    setCurrentStep(0);
  };

  const handleClose = () => {
    setShowTutorialList(true);
    setCurrentTutorial(null);
    setCurrentStep(0);
    onClose();
  };

  if (!isOpen) return null;

  const progress = currentTutorial 
    ? ((currentStep + 1) / currentTutorial.steps.length) * 100 
    : 0;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={handleClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="w-full max-w-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <Card className="border-2">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    {currentTutorial ? (
                      <currentTutorial.icon className="h-5 w-5 text-primary" />
                    ) : (
                      <BookOpen className="h-5 w-5 text-primary" />
                    )}
                  </div>
                  <div>
                    <CardTitle className="text-lg">
                      {currentTutorial ? currentTutorial.title : "Learning Center"}
                    </CardTitle>
                    {!showTutorialList && currentTutorial && (
                      <p className="text-sm text-muted-foreground">
                        Step {currentStep + 1} of {currentTutorial.steps.length}
                      </p>
                    )}
                  </div>
                </div>
                <Button 
                  size="icon" 
                  variant="ghost" 
                  onClick={handleClose}
                  data-testid="button-close-tutorial"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {!showTutorialList && currentTutorial && (
                <Progress value={progress} className="h-1 mt-4" />
              )}
            </CardHeader>

            <CardContent className="pt-4">
              {showTutorialList ? (
                <div className="space-y-4">
                  <p className="text-muted-foreground">
                    Welcome to Strategy Agent! Choose a tutorial to get started:
                  </p>
                  <div className="grid gap-3">
                    {TUTORIALS.map((tutorial) => (
                      <button
                        key={tutorial.id}
                        onClick={() => handleSelectTutorial(tutorial)}
                        className="flex items-center gap-4 p-4 rounded-lg border hover-elevate text-left w-full transition-colors"
                        data-testid={`button-tutorial-${tutorial.id}`}
                      >
                        <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <tutorial.icon className="h-6 w-6 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium">{tutorial.title}</h3>
                          <p className="text-sm text-muted-foreground line-clamp-1">
                            {tutorial.description}
                          </p>
                        </div>
                        <Badge variant="secondary" className="shrink-0">
                          {tutorial.steps.length} steps
                        </Badge>
                        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : currentTutorial && (
                <motion.div
                  key={currentStep}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4"
                >
                  <div className="flex items-center gap-3">
                    {currentTutorial.steps[currentStep].icon && (
                      <div className="h-8 w-8 rounded-md bg-secondary flex items-center justify-center">
                        {(() => {
                          const Icon = currentTutorial.steps[currentStep].icon;
                          return <Icon className="h-4 w-4" />;
                        })()}
                      </div>
                    )}
                    <h3 className="text-lg font-semibold">
                      {currentTutorial.steps[currentStep].title}
                    </h3>
                  </div>

                  <p className="text-muted-foreground leading-relaxed">
                    {currentTutorial.steps[currentStep].content}
                  </p>

                  {currentTutorial.steps[currentStep].tips && (
                    <div className="rounded-lg bg-secondary/50 p-4 space-y-2">
                      <h4 className="text-sm font-medium flex items-center gap-2">
                        <Zap className="h-4 w-4 text-primary" />
                        Key Tips
                      </h4>
                      <ul className="space-y-1.5">
                        {currentTutorial.steps[currentStep].tips!.map((tip, index) => (
                          <li key={index} className="text-sm text-muted-foreground flex items-start gap-2">
                            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                            {tip}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-4 border-t">
                    <Button
                      variant="outline"
                      onClick={currentStep === 0 ? () => setShowTutorialList(true) : handlePrev}
                      data-testid="button-tutorial-prev"
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      {currentStep === 0 ? "Back to List" : "Previous"}
                    </Button>
                    <Button onClick={handleNext} data-testid="button-tutorial-next">
                      {currentStep === currentTutorial.steps.length - 1 ? (
                        <>
                          Complete
                          <CheckCircle2 className="h-4 w-4 ml-1" />
                        </>
                      ) : (
                        <>
                          Next
                          <ChevronRight className="h-4 w-4 ml-1" />
                        </>
                      )}
                    </Button>
                  </div>
                </motion.div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

interface TutorialTriggerProps {
  className?: string;
}

export function TutorialTrigger({ className }: TutorialTriggerProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(true)}
        className={cn("gap-2", className)}
        data-testid="button-open-tutorials"
      >
        <BookOpen className="h-4 w-4" />
        <span className="hidden sm:inline">Tutorials</span>
      </Button>
      <InteractiveTutorial
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}
