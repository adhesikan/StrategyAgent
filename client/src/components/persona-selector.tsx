import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TrendingUp, DollarSign, Layers, GraduationCap, Loader2, Check } from "lucide-react";
import { usePersona } from "@/context/PersonaContext";
import { useToast } from "@/hooks/use-toast";
import type { PersonaId } from "@shared/plans";

interface PersonaOption {
  id: PersonaId;
  title: string;
  tagline: string;
  description: string;
  examples: string;
  icon: typeof TrendingUp;
  recommendedPlan: string;
}

const OPTIONS: PersonaOption[] = [
  {
    id: "buyer",
    title: "Stock & Option Buyer",
    tagline: "I buy stocks or calls to grow money",
    description: "Focus on momentum, breakouts, and directional trades.",
    examples: "Long stocks, long calls, swing setups",
    icon: TrendingUp,
    recommendedPlan: "Trader",
  },
  {
    id: "seller",
    title: "Income / Premium Seller",
    tagline: "I sell covered calls or cash-secured puts",
    description: "Focus on income generation, dividends, and theta strategies.",
    examples: "Covered calls, cash-secured puts, wheel strategy",
    icon: DollarSign,
    recommendedPlan: "Trader",
  },
  {
    id: "complex",
    title: "Complex / Multi-Leg Trader",
    tagline: "I trade spreads, condors, or use automation",
    description: "Advanced multi-leg options, automation, and options flow.",
    examples: "Iron condors, vertical spreads, auto-execution",
    icon: Layers,
    recommendedPlan: "Active Trader",
  },
  {
    id: "learner",
    title: "Learner",
    tagline: "Show me how everything works first",
    description: "Educational mode with paper trading and tutorials.",
    examples: "Tutorials, paper trading, simplified UI",
    icon: GraduationCap,
    recommendedPlan: "Explorer (Free)",
  },
];

interface PersonaSelectorProps {
  open: boolean;
  onComplete: () => void;
}

export function PersonaSelector({ open, onComplete }: PersonaSelectorProps) {
  const [selected, setSelected] = useState<PersonaId | null>(null);
  const [saving, setSaving] = useState(false);
  const { setPersona } = usePersona();
  const { toast } = useToast();

  const handleConfirm = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await setPersona(selected);
      toast({
        title: "Trading style saved",
        description: `Trading style set to ${OPTIONS.find((o) => o.id === selected)?.title}.`,
      });
      onComplete();
    } catch (error) {
      toast({
        title: "Could not save",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-3xl max-h-[90vh] overflow-y-auto"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle data-testid="text-persona-modal-title">What kind of trader are you?</DialogTitle>
          <DialogDescription>
            Pick the option that best describes you. We'll tailor your dashboard, trade ideas, and AI assistant to match. You can change this anytime in Settings.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2 mt-2">
          {OPTIONS.map((option) => {
            const Icon = option.icon;
            const isSelected = selected === option.id;
            return (
              <Card
                key={option.id}
                onClick={() => setSelected(option.id)}
                className={`p-4 cursor-pointer transition-all hover-elevate active-elevate-2 ${
                  isSelected ? "border-primary ring-2 ring-primary" : ""
                }`}
                data-testid={`card-persona-${option.id}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`rounded-md p-2 ${isSelected ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-sm" data-testid={`text-persona-title-${option.id}`}>
                        {option.title}
                      </h3>
                      {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{option.tagline}</p>
                    <p className="text-xs mt-2">{option.description}</p>
                    <p className="text-xs text-muted-foreground mt-1.5 italic">e.g. {option.examples}</p>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mt-2">
                      Best on <span className="font-medium text-foreground">{option.recommendedPlan}</span>
                    </p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        <DialogFooter className="mt-2">
          <Button
            onClick={handleConfirm}
            disabled={!selected || saving}
            data-testid="button-persona-confirm"
            className="w-full sm:w-auto"
          >
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
