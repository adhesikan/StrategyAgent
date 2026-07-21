import { useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ViewMode = "card" | "list";

export function useViewMode(storageKey: string, initial: ViewMode = "card") {
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem(`view-mode:${storageKey}`);
      if (saved === "card" || saved === "list") return saved;
    } catch {}
    return initial;
  });
  const update = (v: ViewMode) => {
    setMode(v);
    try { localStorage.setItem(`view-mode:${storageKey}`, v); } catch {}
  };
  return [mode, update] as const;
}

interface Props {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
  testId?: string;
  className?: string;
}

export function ViewToggle({ value, onChange, testId = "view-toggle", className }: Props) {
  return (
    <div className={cn("flex items-center border rounded-md", className)} data-testid={testId}>
      <Button
        variant="ghost"
        size="icon"
        className={cn("rounded-r-none h-8 w-8", value === "card" && "bg-muted")}
        onClick={() => onChange("card")}
        aria-label="Card view"
        data-testid={`${testId}-card`}
      >
        <LayoutGrid className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn("rounded-l-none h-8 w-8", value === "list" && "bg-muted")}
        onClick={() => onChange("list")}
        aria-label="List view"
        data-testid={`${testId}-list`}
      >
        <List className="h-4 w-4" />
      </Button>
    </div>
  );
}
