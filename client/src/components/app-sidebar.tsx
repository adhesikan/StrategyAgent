import { Link, useLocation } from "wouter";
import {
  Settings,
  Bot,
  ChevronsLeft,
  ChevronsRight,
  History,
  Users,
  Handshake,
  Shield,
  Home,
  Target,
  Search,
  DollarSign,
  Newspaper,
  Radar,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
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
import { useAuth } from "@/hooks/use-auth";

interface NavItem {
  title: string;
  description: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
}

const mainNavItems: NavItem[] = [
  { title: "Home", description: "Dashboard & quick actions", url: "/home", icon: Home },
  { title: "Goal Mode", description: "Goal-driven scenarios", url: "/goal-mode", icon: Target },
  { title: "Opportunity Radar", description: "AI-ranked candidate scenarios", url: "/opportunity-radar", icon: Radar },
  { title: "Trade Finder", description: "Advanced trade builder", url: "/trade-finder", icon: Search },
  { title: "Income Mode", description: "Premium & defined-risk income", url: "/income-mode", icon: DollarSign },
  { title: "Market Intel", description: "News, catalysts, watchlist", url: "/market-intel", icon: Newspaper },
  { title: "History", description: "Generated scenarios", url: "/history", icon: History },
  { title: "Settings", description: "Account, broker & limits", url: "/settings", icon: Settings },
];

function SidebarBrandHeader() {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const { isConnected, providerName, status } = useBrokerStatus();
  const isPaper = status?.preferredAccountId?.startsWith("sandbox:");

  let brokerLabel = "No Broker";
  let brokerColor = "border-border text-muted-foreground";
  let dotColor = "bg-muted-foreground";

  if (isConnected && providerName) {
    if (isPaper) {
      brokerLabel = `Paper: ${providerName}`;
      brokerColor = "border-amber-500/40 text-amber-400";
      dotColor = "bg-amber-400";
    } else {
      brokerLabel = `Live: ${providerName}`;
      brokerColor = "border-green-500/40 text-green-400";
      dotColor = "bg-green-400";
    }
  }

  return (
    <>
      <Link href="/home" aria-label="Go to Home" data-testid="link-home">
        <div className="flex items-center flex-wrap gap-2.5">
          <div className="h-9 w-9 shrink-0 rounded-lg bg-primary/15 p-1 border border-primary/20 flex items-center justify-center">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          {!isCollapsed && (
            <div className="flex flex-col overflow-hidden">
              <span className="font-semibold text-sm leading-tight truncate" data-testid="text-brand-name">Strategy Agent</span>
              <span className="text-[10px] text-muted-foreground leading-tight truncate">AI-powered setups</span>
            </div>
          )}
        </div>
      </Link>

      {!isCollapsed && (
        <div className="mt-2" data-testid="status-chips">
          <span className={cn(
            "inline-flex items-center gap-1 text-[10px] leading-none px-1.5 py-0.5 rounded-full border",
            brokerColor
          )} data-testid="badge-broker-status">
            <span className={cn("h-1.5 w-1.5 rounded-full", dotColor)} />
            {brokerLabel}
          </span>
        </div>
      )}
    </>
  );
}

export function AppSidebar() {
  const [location] = useLocation();
  const { setOpenMobile, isMobile, state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const adminItems: NavItem[] = isAdmin ? [
    { title: "Users", description: "User administration", url: "/admin/users", icon: Users },
    { title: "Partners", description: "Signal providers", url: "/admin/partners", icon: Handshake },
    { title: "Compliance", description: "Acceptance logs", url: "/admin/disclaimer-logs", icon: Shield },
  ] : [];

  const allItems = [...mainNavItems, ...adminItems];

  const handleNavClick = () => {
    if (isMobile) setOpenMobile(false);
  };

  const isActive = (url: string) => {
    if (url === "/home") return location === "/home";
    if (url === "/trade-finder") return location === "/trade-finder" || location === "/agent";
    if (url === "/history") return location === "/history" || location === "/trade-setups";
    if (url === "/settings") return location === "/settings" || location.startsWith("/settings/");
    return location === url;
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-3 group-data-[collapsible=icon]:p-2">
        <SidebarBrandHeader />
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent className="px-2 group-data-[collapsible=icon]:px-1">
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <SidebarMenu className="gap-2">
              {allItems.map((item) => {
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
                        data-testid={`link-nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
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
      </SidebarContent>

      <SidebarFooter className="p-3 group-data-[collapsible=icon]:p-2">
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
