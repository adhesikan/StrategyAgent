import { Link } from "wouter";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface HelpLinkProps {
  section: string;
  label?: string;
  className?: string;
  variant?: "icon" | "inline";
}

export function HelpLink({ section, label = "Help", className, variant = "icon" }: HelpLinkProps) {
  const href = `/guide#${section}`;
  if (variant === "inline") {
    return (
      <Link
        href={href}
        className={cn(
          "inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline",
          className,
        )}
        data-testid={`link-help-${section}`}
      >
        <HelpCircle className="h-3.5 w-3.5" />
        <span>{label}</span>
      </Link>
    );
  }
  return (
    <Link
      href={href}
      title={`${label}: open user guide`}
      aria-label={`${label}: open user guide`}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
      data-testid={`link-help-${section}`}
    >
      <HelpCircle className="h-4 w-4" />
    </Link>
  );
}
