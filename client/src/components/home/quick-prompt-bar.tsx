import { useEffect, useState, useRef } from "react";
import { useLocation } from "wouter";
import { Sparkles, ArrowRight } from "lucide-react";

const PLACEHOLDERS = [
  "How can I grow $10k?",
  "Find income ideas today",
  "Why is NVDA down?",
  "Show bullish setups under $200 risk",
];

function routeForPrompt(raw: string): string {
  const prompt = raw.trim();
  if (!prompt) return "/ask";
  return `/ask?q=${encodeURIComponent(prompt)}`;
}

export function QuickPromptBar() {
  const [, navigate] = useLocation();
  const [value, setValue] = useState("");
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PLACEHOLDERS.length);
    }, 3500);
    return () => clearInterval(id);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const dest = routeForPrompt(value || PLACEHOLDERS[placeholderIdx]);
    navigate(dest);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="relative rounded-2xl border border-border/60 bg-gradient-to-br from-card/80 to-card/40 backdrop-blur p-1.5 shadow-sm hover-elevate transition-all"
      data-testid="form-quick-prompt"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary ml-1">
          <Sparkles className="h-4 w-4" />
        </div>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={PLACEHOLDERS[placeholderIdx]}
          className="flex-1 bg-transparent border-0 outline-none text-sm md:text-base placeholder:text-muted-foreground/70 py-2 min-w-0"
          data-testid="input-quick-prompt"
          aria-label="Ask VCP Trader AI"
        />
        <button
          type="submit"
          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 md:px-4 py-2 text-sm font-medium text-primary-foreground hover-elevate active-elevate-2"
          data-testid="button-quick-prompt-submit"
        >
          <span className="hidden sm:inline">Ask</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </form>
  );
}
