import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { 
  X, Rocket, TrendingUp, Search, Bell, Zap, 
  CheckCircle2, ArrowRight, BookOpen, ChevronRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import type { UserSettings } from "@shared/schema";

interface WelcomeStep {
  id: string;
  title: string;
  description: string;
  icon: any;
  color: string;
}

const WELCOME_STEPS: WelcomeStep[] = [
  {
    id: "find",
    title: "Find Trading Setups",
    description: "Our 9 scanning strategies identify high-probability setups across VCP patterns, breakouts, and intraday signals.",
    icon: Search,
    color: "text-blue-500",
  },
  {
    id: "analyze",
    title: "Analyze with Precision",
    description: "Auto-calculated resistance levels, stop losses, and pattern scores help you make informed decisions.",
    icon: TrendingUp,
    color: "text-green-500",
  },
  {
    id: "alerts",
    title: "Never Miss a Trade",
    description: "Real-time push notifications alert you when breakouts occur, stops are hit, or prices approach key levels.",
    icon: Bell,
    color: "text-amber-500",
  },
  {
    id: "execute",
    title: "Execute with Confidence",
    description: "Connect your brokerage for live data and trade directly from your analysis with calculated risk management.",
    icon: Zap,
    color: "text-purple-500",
  },
];

interface WelcomeTutorialProps {
  onClose?: () => void;
  forceShow?: boolean;
}

export function WelcomeTutorial({ onClose, forceShow }: WelcomeTutorialProps) {
  const [step, setStep] = useState(0);
  const [showWelcome, setShowWelcome] = useState(false);
  const { user } = useAuth();

  const { data: settings } = useQuery<UserSettings>({
    queryKey: ["/api/user/settings"],
    enabled: !!user,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (updates: Record<string, boolean>) => {
      await apiRequest("PATCH", "/api/user/settings", updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
    },
  });

  useEffect(() => {
    if (forceShow) {
      setShowWelcome(true);
      return;
    }
    if (settings && !settings.hasSeenWelcomeTutorial) {
      setShowWelcome(true);
    }
  }, [settings, forceShow]);

  const handleNext = () => {
    if (step < WELCOME_STEPS.length - 1) {
      setStep(step + 1);
    } else {
      handleComplete();
    }
  };

  const handleSkip = () => {
    handleComplete();
  };

  const handleComplete = () => {
    updateSettingsMutation.mutate({ hasSeenWelcomeTutorial: true });
    setShowWelcome(false);
    if (onClose) {
      onClose();
    }
  };

  if (!showWelcome) return null;

  const isLastStep = step === WELCOME_STEPS.length - 1;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ duration: 0.3, type: "spring", bounce: 0.3 }}
          className="w-full max-w-lg"
        >
          <Card className="border-2 overflow-hidden">
            <div className="relative bg-gradient-to-br from-primary/20 via-primary/10 to-transparent p-6 pb-8">
              <Button
                size="icon"
                variant="ghost"
                onClick={handleSkip}
                className="absolute top-3 right-3"
                data-testid="button-skip-welcome"
              >
                <X className="h-4 w-4" />
              </Button>

              <motion.div
                key="header"
                initial={{ y: -10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="flex items-center gap-3 mb-4"
              >
                <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center shadow-lg">
                  <Rocket className="h-6 w-6 text-primary-foreground" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold">Welcome to VCP Trader AI</h2>
                  <p className="text-muted-foreground text-sm">by Sunfish Technologies</p>
                </div>
              </motion.div>

              <div className="flex gap-1.5 mt-4">
                {WELCOME_STEPS.map((_, index) => (
                  <div
                    key={index}
                    className={`h-1.5 flex-1 rounded-full transition-colors ${
                      index <= step ? "bg-primary" : "bg-primary/20"
                    }`}
                  />
                ))}
              </div>
            </div>

            <CardContent className="p-6">
              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: 30 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -30 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4"
                >
                  <div className="flex items-start gap-4">
                    <div className={`h-14 w-14 rounded-xl bg-secondary flex items-center justify-center shrink-0`}>
                      {(() => {
                        const Icon = WELCOME_STEPS[step].icon;
                        return <Icon className={`h-7 w-7 ${WELCOME_STEPS[step].color}`} />;
                      })()}
                    </div>
                    <div className="pt-1">
                      <h3 className="text-lg font-semibold mb-1">
                        {WELCOME_STEPS[step].title}
                      </h3>
                      <p className="text-muted-foreground">
                        {WELCOME_STEPS[step].description}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 pt-4 border-t mt-6">
                    <div className="flex-1 flex items-center gap-2">
                      {WELCOME_STEPS.map((s, i) => (
                        <button
                          key={s.id}
                          onClick={() => setStep(i)}
                          className={`h-2 w-2 rounded-full transition-all ${
                            i === step 
                              ? "bg-primary w-4" 
                              : i < step 
                                ? "bg-primary/50" 
                                : "bg-muted-foreground/30"
                          }`}
                          data-testid={`button-step-${i}`}
                        />
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        onClick={handleSkip}
                        data-testid="button-skip"
                      >
                        Skip
                      </Button>
                      <Button
                        onClick={handleNext}
                        data-testid="button-welcome-next"
                      >
                        {isLastStep ? (
                          <>
                            Get Started
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
                  </div>
                </motion.div>
              </AnimatePresence>
            </CardContent>
          </Card>

          {isLastStep && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="mt-4 text-center"
            >
              <p className="text-sm text-muted-foreground flex items-center justify-center gap-2">
                <BookOpen className="h-4 w-4" />
                Access tutorials anytime from the Tutorials button
              </p>
            </motion.div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
