import { useState } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export interface HowToStep {
  title: string;
  detail: string;
}

interface HowToUseSectionProps {
  title?: string;
  steps: HowToStep[];
  defaultOpen?: boolean;
  testIdSlug?: string;
  className?: string;
}

export function HowToUseSection({
  title = "How to use this page",
  steps,
  defaultOpen = false,
  testIdSlug = "default",
  className,
}: HowToUseSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card className={cn("border-border/60", className)} data-testid={`how-to-${testIdSlug}`}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          className="flex w-full items-center justify-between gap-3 p-3 text-left hover-elevate rounded-md"
          data-testid={`how-to-trigger-${testIdSlug}`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <HelpCircle className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-medium truncate">{title}</span>
          </div>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform shrink-0",
              open && "rotate-180",
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ol className="px-4 pb-4 pt-1 space-y-2 text-sm">
            {steps.map((step, i) => (
              <li
                key={i}
                className="flex gap-3"
                data-testid={`how-to-step-${testIdSlug}-${i}`}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary text-[11px] font-semibold mt-0.5">
                  {i + 1}
                </span>
                <div className="space-y-0.5">
                  <div className="font-medium">{step.title}</div>
                  <div className="text-muted-foreground text-xs leading-snug">
                    {step.detail}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
