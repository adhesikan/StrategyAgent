import { Link, useLocation } from "wouter";
import { Bot, Lightbulb, Search as SearchIcon, Newspaper, Landmark, Loader2, LogOut, User, Bell, Sparkles, Pin, Check, BookOpen, LayoutDashboard, Wallet, GraduationCap, Settings as SettingsIcon, Globe2 } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { LANDING_PAGE_OPTIONS } from "@shared/schema";
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

// Sprint 5.5: Authenticated nav prioritizes the dashboard and core workflows.
// Public marketing nav (unauthenticated users) is unchanged — it never renders
// TopNav directly; unauthenticated visitors see PublicRoutes with HomePage.
const NAV_ITEMS: TopNavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    testId: "topnav-dashboard",
    matches: (p) => p === "/dashboard",
  },
  {
    label: "Ask AI",
    href: "/ask",
    icon: Sparkles,
    testId: "topnav-ask",
    matches: (p) => p === "/ask",
  },
  {
    label: "Research",
    href: "/research",
    icon: BookOpen,
    testId: "topnav-research",
    matches: (p) => p === "/research" || p.startsWith("/research/"),
  },
  {
    label: "Portfolio",
    href: "/settings?tab=broker",
    icon: Wallet,
    testId: "topnav-portfolio",
    matches: (p) => false, // settings tab — never shows as "active page"
  },
  {
    label: "Intelligence",
    href: "/intelligence",
    icon: Globe2,
    testId: "topnav-intelligence",
    matches: (p) => p === "/intelligence" || p.startsWith("/intelligence/"),
  },
  {
    label: "Congress",
    href: "/markets/congress-activity",
    icon: Landmark,
    testId: "topnav-congress",
    matches: (p) =>
      p === "/markets/congress-activity" ||
      p.startsWith("/markets/congress-activity/"),
  },
  {
    label: "Education",
    href: "/guide",
    icon: GraduationCap,
    testId: "topnav-education",
    matches: (p) => p === "/guide" || p.startsWith("/guide/") || p === "/help",
  },
  {
    label: "Settings",
    href: "/settings",
    icon: SettingsIcon,
    testId: "topnav-settings",
    matches: (p) => p === "/settings" || p.startsWith("/settings/"),
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
      label = `Sandbox: ${providerName}`;
      pillClass = "border-amber-500/40 text-amber-400 bg-amber-500/5";
    } else {
      dotClass = "bg-emerald-400";
      label = `Live: ${providerName}`;
      pillClass = "border-emerald-500/40 text-emerald-400 bg-emerald-500/5";
    }
  }

  return (
    <div className="flex items-center gap-3 min-w-0">
      <Link href="/dashboard" aria-label="Go to Dashboard" data-testid="link-brand">
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

// Menu item to pin the page the user is currently on as their default
// landing page after login. Only shown when the current path is one of the
// approved landing pages; shows a check when it's already the default.
function SetDefaultPageItem() {
  const [location] = useLocation();
  const { toast } = useToast();
  const { data: settings } = useQuery<{ defaultLandingPage?: string }>({
    queryKey: ["/api/user/settings"],
  });
  const option = LANDING_PAGE_OPTIONS.find((o) => o.value === location);
  const isDefault = option && settings?.defaultLandingPage === option.value;

  const mutation = useMutation({
    mutationFn: async (path: string) => {
      const res = await apiRequest("PUT", "/api/user/settings", { defaultLandingPage: path });
      return res.json();
    },
    onSuccess: (_data, path) => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
      const label = LANDING_PAGE_OPTIONS.find((o) => o.value === path)?.label ?? path;
      toast({ title: "Default page updated", description: `${label} will now open when you log in.` });
    },
    onError: () => {
      toast({ title: "Couldn't update default page", description: "Please try again.", variant: "destructive" });
    },
  });

  if (!option) return null;

  return (
    <DropdownMenuItem
      onClick={(e) => {
        e.preventDefault();
        if (!isDefault && !mutation.isPending) mutation.mutate(option.value);
      }}
      disabled={mutation.isPending}
      data-testid="menu-set-default-page"
    >
      {mutation.isPending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : isDefault ? (
        <Check className="mr-2 h-4 w-4 text-emerald-500" />
      ) : (
        <Pin className="mr-2 h-4 w-4" />
      )}
      {isDefault ? `${option.label} is your default page` : `Make ${option.label} my default page`}
    </DropdownMenuItem>
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
        <SetDefaultPageItem />
        <DropdownMenuItem asChild>
          <Link href="/settings" className="flex items-center gap-2" data-testid="menu-link-settings">
            <User className="h-4 w-4" /> Settings
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
