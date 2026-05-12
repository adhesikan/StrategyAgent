import { Link, useLocation } from "wouter";
import { Bot, Lightbulb, BookOpen, Search as SearchIcon, Newspaper, Loader2, LogOut, User, Bell, HelpCircle, Sparkles, Target } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type { AlertEvent } from "@shared/schema";

interface TopNavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  testId: string;
  matches: (path: string) => boolean;
}

const NAV_ITEMS: TopNavItem[] = [
  {
    label: "Ideas",
    href: "/home",
    icon: Lightbulb,
    testId: "topnav-ideas",
    matches: (p) =>
      p === "/home" ||
      p === "/goal-mode" ||
      p === "/income-mode" ||
      p === "/trade-finder" ||
      p === "/agent",
  },
  {
    label: "Journal",
    href: "/journal",
    icon: BookOpen,
    testId: "topnav-journal",
    matches: (p) => p === "/journal" || p === "/history" || p === "/trade-setups",
  },
  {
    label: "Scanner",
    href: "/scanner",
    icon: SearchIcon,
    testId: "topnav-scanner",
    matches: (p) => p === "/scanner" || p === "/discover" || p === "/opportunity-radar",
  },
  {
    label: "Markets",
    href: "/markets",
    icon: Newspaper,
    testId: "topnav-markets",
    matches: (p) => p === "/markets" || p === "/market-intel" || p === "/news",
  },
  {
    label: "Best Trade",
    href: "/best-trade",
    icon: Target,
    testId: "topnav-best-trade",
    matches: (p) => p === "/best-trade",
  },
  {
    label: "Ask AI",
    href: "/ask",
    icon: Sparkles,
    testId: "topnav-ask",
    matches: (p) => p === "/ask",
  },
];

function BrandWithStatus() {
  const { isConnected, providerName, status } = useBrokerStatus();
  const isPaper = status?.preferredAccountId?.startsWith("sandbox:");

  let dotClass = "bg-muted-foreground";
  let label = "No broker";
  let pillClass = "border-border text-muted-foreground bg-muted/30";
  if (isConnected && providerName) {
    if (isPaper) {
      dotClass = "bg-amber-400";
      label = `Paper: ${providerName}`;
      pillClass = "border-amber-500/40 text-amber-400 bg-amber-500/5";
    } else {
      dotClass = "bg-emerald-400";
      label = `Live: ${providerName}`;
      pillClass = "border-emerald-500/40 text-emerald-400 bg-emerald-500/5";
    }
  }

  return (
    <div className="flex items-center gap-3 min-w-0">
      <Link href="/home" aria-label="Go to Ideas" data-testid="link-brand">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-8 w-8 shrink-0 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          <span
            className="font-semibold text-sm leading-none whitespace-nowrap hidden sm:inline"
            data-testid="text-brand-name"
          >
            VCP Trader AI
          </span>
        </div>
      </Link>
      <span
        className={cn(
          "hidden md:inline-flex items-center gap-1.5 text-[11px] leading-none px-2 py-1 rounded-full border whitespace-nowrap",
          pillClass,
        )}
        data-testid="badge-broker-status"
        title={label}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", dotClass)} />
        {label}
      </span>
    </div>
  );
}

function NavLinks() {
  const [location] = useLocation();
  return (
    <nav className="flex items-center gap-0.5 sm:gap-1" aria-label="Primary" data-testid="topnav-links">
      {NAV_ITEMS.map((item) => {
        const active = item.matches(location);
        const Icon = item.icon;
        return (
          <Link key={item.label} href={item.href} data-testid={item.testId}>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/40",
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{item.label}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function AlertBell() {
  const { data: alertEvents } = useQuery<AlertEvent[]>({
    queryKey: ["/api/alert-events"],
    refetchInterval: 30000,
  });
  const unreadCount = alertEvents?.filter((e) => !e.isRead).length || 0;

  return (
    <Link href="/alerts?tab=history" data-testid="link-alerts-bell">
      <Button variant="ghost" size="icon" className="relative" data-testid="button-alert-bell">
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <Badge
            className="absolute -top-1 -right-1 h-4 min-w-4 rounded-full bg-destructive text-destructive-foreground text-xs font-medium flex items-center justify-center px-1 border-0"
            data-testid="badge-unread-alerts"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </Badge>
        )}
      </Button>
    </Link>
  );
}

function UserMenu() {
  const { user, logout, isLoggingOut } = useAuth();
  if (!user) return null;
  const initials =
    [user.firstName?.[0], user.lastName?.[0]].filter(Boolean).join("").toUpperCase() ||
    user.email?.[0]?.toUpperCase() ||
    "U";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" data-testid="button-user-menu">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium" data-testid="text-user-email">
            {user.email}
          </p>
          <p className="text-xs text-muted-foreground">
            {user.role === "admin" ? "Administrator" : "Member"}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings" className="flex items-center gap-2" data-testid="menu-link-settings">
            <User className="h-4 w-4" /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/guide" className="flex items-center gap-2" data-testid="menu-link-guide">
            <HelpCircle className="h-4 w-4" /> User Guide
          </Link>
        </DropdownMenuItem>
        {user.role === "admin" && (
          <DropdownMenuItem asChild>
            <Link href="/admin" className="flex items-center gap-2" data-testid="menu-link-admin">
              <User className="h-4 w-4" /> Admin
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => logout()}
          disabled={isLoggingOut}
          data-testid="button-logout"
        >
          {isLoggingOut ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="mr-2 h-4 w-4" />
          )}
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopNav() {
  return (
    <header
      className="sticky top-0 z-50 h-14 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
      data-testid="top-nav"
    >
      <div className="h-full max-w-[1600px] mx-auto px-3 md:px-6 flex items-center gap-3 md:gap-6">
        <BrandWithStatus />
        <div className="flex-1 flex items-center justify-center md:justify-start">
          <NavLinks />
        </div>
        <div className="flex items-center gap-1">
          <AlertBell />
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
