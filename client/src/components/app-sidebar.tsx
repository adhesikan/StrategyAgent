import { Link, useLocation } from "wouter";
import {
  Search,
  Settings,
  Newspaper,
  Target,
  Bot,
  ChevronsLeft,
  ChevronsRight,
  Zap,
  Radio,
  History,
  BookOpen,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";

interface NavItem {
  title: string;
  description: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: "DISCOVER",
    items: [
      { title: "Dashboard", description: "Overview & positions", url: "/command-center", icon: Target },
      { title: "Opportunities", description: "Scan & explore", url: "/discover", icon: Search },
    ],
  },
  {
    label: "TRADE",
    items: [
      { title: "Trade Autopilot", description: "Modes & controls", url: "/automation", icon: Bot },
      { title: "Activity", description: "Alerts & history", url: "/alerts", icon: History },
    ],
  },
  {
    label: "LEARN",
    items: [
      { title: "News", description: "Market headlines", url: "/news", icon: Newspaper },
      { title: "Strategy Guide", description: "Learn patterns", url: "/help", icon: BookOpen },
    ],
  },
  {
    label: "CONTROL",
    items: [
      { title: "Settings", description: "Account & config", url: "/settings", icon: Settings },
    ],
  },
];

function SidebarBrandHeader() {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const { isConnected, providerName, status } = useBrokerStatus();
  const { user } = useAuth();

  const { data: agentState } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/agent/state"],
    enabled: !!user,
  });

  const isPaper = status?.preferredAccountId?.startsWith("sandbox:");

  let brokerLabel = "Not Connected";
  if (isConnected && providerName) {
    brokerLabel = isPaper ? `Paper: ${providerName}` : `Live: ${providerName}`;
  }

  const automationActive = agentState?.enabled ?? false;

  return (
    <>
      <Link href="/command-center" aria-label="Go to Dashboard" data-testid="link-home">
        <div className="flex items-center flex-wrap gap-2.5">
          <div className="h-9 w-9 shrink-0 rounded-lg bg-white/10 p-0.5 border border-border/40">
            <img
              src="/logo.png"
              alt="VCP Trader"
              className="h-full w-full object-contain rounded-md"
              data-testid="img-logo"
            />
          </div>
          {!isCollapsed && (
            <div className="flex flex-col overflow-hidden">
              <span className="font-semibold text-sm leading-tight truncate" data-testid="text-brand-name">VCP Trader</span>
              <span className="text-[10px] text-muted-foreground leading-tight truncate">by Sunfish Technologies</span>
            </div>
          )}
        </div>
      </Link>

      {!isCollapsed && (
        <div className="flex flex-wrap items-center gap-1 mt-2" data-testid="status-chips">
          <span className={cn(
            "inline-flex items-center gap-1 text-[10px] leading-none px-1.5 py-0.5 rounded-full border",
            isConnected && !isPaper && "border-green-500/40 text-green-400",
            isPaper && "border-amber-500/40 text-amber-400",
            !isConnected && "border-border text-muted-foreground"
          )} data-testid="badge-broker-status">
            <span className={cn(
              "h-1.5 w-1.5 rounded-full",
              isConnected && !isPaper && "bg-green-400",
              isPaper && "bg-amber-400",
              !isConnected && "bg-muted-foreground"
            )} />
            {brokerLabel}
          </span>
          <span
            className="inline-flex items-center text-[10px] leading-none px-1.5 py-0.5 rounded-full border border-border text-muted-foreground"
            data-testid="badge-plan"
          >
            Pro
          </span>
          {automationActive && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] leading-none px-1.5 py-0.5 rounded-full border border-border text-muted-foreground"
              data-testid="badge-automation"
            >
              <Zap className="h-2.5 w-2.5" />
              Auto
            </span>
          )}
        </div>
      )}
    </>
  );
}

export function AppSidebar() {
  const [location] = useLocation();
  const { setOpenMobile, isMobile, state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";

  const handleNavClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const isActive = (url: string) => {
    const search = typeof window !== "undefined" ? window.location.search : "";
    if (url === "/command-center") return location === "/command-center";
    if (url === "/discover") {
      return location === "/discover" || location === "/" || location === "/scanner" || location === "/signals" || location === "/watchlists" || location === "/app/stocks" || location === "/app/options" || location === "/charts" || location.startsWith("/charts/");
    }
    if (url === "/automation?view=alerts") {
      return location === "/automation" && (search.includes("view=alerts") || search.includes("view=history"));
    }
    if (url === "/automation") {
      if (search.includes("view=alerts") || search.includes("view=history")) return false;
      return location === "/automation" || location === "/app/automation" || location === "/execution" || location === "/opportunities";
    }
    if (url === "/alerts") {
      return location === "/alerts";
    }
    if (url === "/news") return location === "/news" || location === "/learn/news";
    if (url === "/help") {
      return location === "/help" || location === "/strategy-guide";
    }
    if (url === "/settings") {
      return location === "/settings" || location.startsWith("/settings/");
    }
    return location === url;
  };

  const isMarketHours = () => {
    const now = new Date();
    const etOffset = -5;
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const et = new Date(utc + 3600000 * etOffset);
    const hour = et.getHours();
    const minute = et.getMinutes();
    const day = et.getDay();
    if (day === 0 || day === 6) return false;
    const timeInMinutes = hour * 60 + minute;
    return timeInMinutes >= 570 && timeInMinutes <= 960;
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-3 group-data-[collapsible=icon]:p-2">
        <SidebarBrandHeader />
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent className="px-2 group-data-[collapsible=icon]:px-1">
        {navGroups.map((group, groupIndex) => (
          <div key={group.label}>
            <SidebarGroup className="py-1">
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-2">
                  {group.items.map((item) => {
                    const active = isActive(item.url);
                    return (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          size="lg"
                          variant="outline"
                          tooltip={item.title}
                          className="h-auto py-3"
                        >
                          <Link
                            href={item.url}
                            onClick={handleNavClick}
                            data-testid={`link-nav-${item.title.toLowerCase()}`}
                          >
                            <div className={cn(
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                              active
                                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                                : "bg-accent/50 text-foreground"
                            )}>
                              <item.icon className="h-4 w-4" />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="text-sm font-medium leading-tight truncate">{item.title}</span>
                              <span className={cn(
                                "text-xs leading-tight truncate",
                                active ? "text-sidebar-accent-foreground/70" : "text-muted-foreground"
                              )}>{item.description}</span>
                            </div>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            {groupIndex < navGroups.length - 1 && <SidebarSeparator className="my-1" />}
          </div>
        ))}
      </SidebarContent>

      <SidebarFooter className="p-3 group-data-[collapsible=icon]:p-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground group-data-[collapsible=icon]:justify-center">
          <Radio className={cn(
            "h-3 w-3 shrink-0",
            isMarketHours() ? "text-green-500" : "text-muted-foreground"
          )} />
          <span className="group-data-[collapsible=icon]:hidden">{isMarketHours() ? "Live Scan Active" : "Market Closed"}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleSidebar}
          className="w-full group-data-[collapsible=icon]:w-auto"
          data-testid="button-toggle-sidebar"
        >
          {isCollapsed && !isMobile ? (
            <ChevronsRight className="h-4 w-4" />
          ) : (
            <>
              <ChevronsLeft className="h-4 w-4" />
              <span className="group-data-[collapsible=icon]:hidden">Collapse</span>
            </>
          )}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
