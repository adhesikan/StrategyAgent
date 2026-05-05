import { Moon, Sun, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme-provider";

export function ThemeToggle() {
  const { theme, resolvedTheme, toggleTheme } = useTheme();

  const icon =
    theme === "auto" ? (
      <Clock className="h-4 w-4" />
    ) : resolvedTheme === "dark" ? (
      <Sun className="h-4 w-4" />
    ) : (
      <Moon className="h-4 w-4" />
    );

  const label =
    theme === "auto"
      ? `Theme: Auto (currently ${resolvedTheme}). Click for dark.`
      : theme === "dark"
        ? "Theme: Dark. Click for light."
        : "Theme: Light. Click for auto.";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      data-testid="button-theme-toggle"
    >
      {icon}
    </Button>
  );
}
