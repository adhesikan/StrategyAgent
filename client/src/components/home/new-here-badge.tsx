import { useLocation } from "wouter";
import { ArrowRight, Sparkles } from "lucide-react";

export function NewHereBadge() {
  const [, navigate] = useLocation();
  return (
    <button
      type="button"
      onClick={() => navigate("/goal-mode")}
      data-testid="badge-new-here"
      className="group inline-flex items-center gap-3 rounded-full border border-primary/30 bg-primary/5 hover:bg-primary/10 px-3 py-1.5 transition-colors text-left"
    >
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
        <Sparkles className="h-3 w-3" />
        New Here?
      </span>
      <span className="text-xs md:text-sm font-medium text-foreground/90 inline-flex items-center gap-1">
        Start with Grow My Money
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}
