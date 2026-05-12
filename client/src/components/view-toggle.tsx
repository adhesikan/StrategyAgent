import { LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ViewMode = "card" | "list";

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
