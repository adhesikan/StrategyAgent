import { useLocation } from "wouter";
import { Sparkles } from "lucide-react";

interface Chip {
  label: string;
  href: string;
  testId: string;
}

const CHIPS: Chip[] = [
  { label: "Grow $10k conservatively", href: "/goal-mode?prompt=Grow%20%2410k%20conservatively", testId: "chip-grow-10k" },
  { label: "Income ideas under $200 risk", href: "/income-mode?prompt=Income%20ideas%20under%20%24200%20risk", testId: "chip-income-200" },
  { label: "Why is TSLA moving?", href: "/market-intel?symbol=TSLA", testId: "chip-why-tsla" },
  { label: "Best setups today", href: "/opportunity-radar", testId: "chip-best-setups" },
  { label: "Covered call ideas", href: "/income-mode?prompt=Covered%20call%20ideas", testId: "chip-covered-calls" },
];

export function PopularChips() {
  const [, navigate] = useLocation();
  return (
    <section className="space-y-3" data-testid="section-popular-chips">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Popular Today
        </h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {CHIPS.map((chip) => (
          <button
            key={chip.label}
            type="button"
            onClick={() => navigate(chip.href)}
            data-testid={chip.testId}
            className="rounded-full border border-border/60 bg-card/40 backdrop-blur px-3 py-1.5 text-xs md:text-sm text-foreground/90 hover-elevate active-elevate-2 transition-all"
          >
            {chip.label}
          </button>
        ))}
      </div>
    </section>
  );
}
