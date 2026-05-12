import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, DollarSign, Layers, GraduationCap, Loader2, Check } from "lucide-react";
import { usePersona } from "@/context/PersonaContext";
import { useToast } from "@/hooks/use-toast";
import type { PersonaId } from "@shared/plans";

const OPTIONS: Array<{
  id: PersonaId;
  title: string;
  tagline: string;
  examples: string;
  icon: typeof TrendingUp;
}> = [
  {
    id: "buyer",
    title: "Stock & Option Buyer",
    tagline: "I buy stocks or calls to grow money",
    examples: "Long stocks, long calls, swing setups",
    icon: TrendingUp,
  },
  {
    id: "seller",
    title: "Income / Premium Seller",
    tagline: "I sell covered calls or cash-secured puts",
    examples: "Covered calls, cash-secured puts, wheel strategy",
    icon: DollarSign,
  },
  {
    id: "complex",
    title: "Complex / Multi-Leg Trader",
    tagline: "I trade spreads, condors, or use automation",
    examples: "Iron condors, vertical spreads, auto-execution",
    icon: Layers,
  },
  {
    id: "learner",
    title: "Learner",
    tagline: "Show me how everything works first",
    examples: "Tutorials, paper trading, simplified UI",
    icon: GraduationCap,
  },
];

export function TradingStyleSection() {
  const { persona, setPersona } = usePersona();
  const [selected, setSelected] = useState<PersonaId | null>(persona);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const dirty = selected !== null && selected !== persona;

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await setPersona(selected);
      toast({
        title: "Trading style updated",
        description: `Your home page, prompts, and recommendations now match: ${OPTIONS.find((o) => o.id === selected)?.title}.`,
      });
    } catch (err) {
      toast({ title: "Couldn't save", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">My Trading Style</CardTitle>
        <CardDescription>
          We use this to tune your home page, prompts, and surfaced ideas. You can change it anytime.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          {OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const isSelected = selected === opt.id;
            const isCurrent = persona === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSelected(opt.id)}
                className={`text-left rounded-lg border p-4 hover-elevate transition-all ${
                  isSelected ? "border-primary ring-2 ring-primary/30" : "border-border"
                }`}
                data-testid={`button-style-${opt.id}`}
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-md bg-primary/10 p-2 shrink-0">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-sm">{opt.title}</h4>
                      {isCurrent && (
                        <Badge variant="secondary" className="text-[10px]">
                          <Check className="h-2.5 w-2.5 mr-0.5" /> Current
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{opt.tagline}</p>
                    <p className="text-[11px] text-muted-foreground/80 mt-1.5 italic">{opt.examples}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-end gap-2">
          {dirty && (
            <Button variant="ghost" size="sm" onClick={() => setSelected(persona)} data-testid="button-cancel-style">
              Cancel
            </Button>
          )}
          <Button onClick={save} disabled={!dirty || saving} data-testid="button-save-style">
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Save trading style
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
