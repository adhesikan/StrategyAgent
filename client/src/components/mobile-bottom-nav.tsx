import { Link, useLocation } from "wouter";
import { Home, TrendingUp, DollarSign, Search, Menu } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

interface Tab {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  testId: string;
  matches?: (path: string) => boolean;
  onClick?: () => void;
}

export function MobileBottomNav() {
  const [location] = useLocation();
  const { setOpenMobile } = useSidebar();

  const tabs: Tab[] = [
    { label: "Home", icon: Home, href: "/home", testId: "tab-home", matches: (p) => p === "/home" },
    { label: "Grow", icon: TrendingUp, href: "/goal-mode", testId: "tab-grow", matches: (p) => p === "/goal-mode" },
    { label: "Income", icon: DollarSign, href: "/income-mode", testId: "tab-income", matches: (p) => p === "/income-mode" },
    { label: "Trade", icon: Search, href: "/trade-finder", testId: "tab-trade", matches: (p) => p === "/trade-finder" || p === "/agent" },
    { label: "More", icon: Menu, testId: "tab-more", onClick: () => setOpenMobile(true) },
  ];

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 pb-[env(safe-area-inset-bottom)]"
      data-testid="mobile-bottom-nav"
      aria-label="Primary"
    >
      <div className="grid grid-cols-5">
        {tabs.map((tab) => {
          const active = tab.matches ? tab.matches(location) : false;
          const content = (
            <div className="flex flex-col items-center justify-center gap-0.5 py-2">
              <tab.icon className={cn("h-5 w-5", active ? "text-primary" : "text-muted-foreground")} />
              <span className={cn("text-[10px] leading-none", active ? "text-primary font-medium" : "text-muted-foreground")}>
                {tab.label}
              </span>
            </div>
          );
          if (tab.href) {
            return (
              <Link key={tab.label} href={tab.href} data-testid={tab.testId} className="block hover-elevate active-elevate-2">
                {content}
              </Link>
            );
          }
          return (
            <button
              key={tab.label}
              type="button"
              onClick={tab.onClick}
              data-testid={tab.testId}
              className="block hover-elevate active-elevate-2 w-full"
            >
              {content}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
