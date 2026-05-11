import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Settings,
  Bot,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  ChevronRight,
  History,
  Users,
  Handshake,
  Shield,
  Home,
  TrendingUp,
  Search,
  DollarSign,
  Newspaper,
  Radar,
  SlidersHorizontal,
  LineChart,
  Bell,
  Compass,
  Workflow,
  Beaker,
  Wrench,
  Mail,
  Eye,
  LayoutDashboard,
  BarChart3,
  BookOpen,
  Zap,
  HelpCircle,
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
import { usePersona } from "@/context/PersonaContext";
import { usePlan } from "@/context/PlanContext";

interface NavItem {
  title: string;
  description: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
}

const mainNavItems: NavItem[] = [
  { title: "Home", description: "Today's ideas, your starting point", url: "/home", icon: Home },
  { title: "Grow", description: "Stock & options growth ideas", url: "/goal-mode", icon: TrendingUp },
  { title: "Income", description: "Covered calls, CSPs, defined-risk income", url: "/income-mode", icon: DollarSign },
  { title: "Trade", description: "Describe a setup in plain English", url: "/trade-finder", icon: BarChart3 },
  { title: "Markets", description: "News, catalysts, sentiment", url: "/market-intel", icon: Newspaper },
];

const moreNavItems: NavItem[] = [
  { title: "Top Opportunities", description: "AI-ranked candidate scenarios", url: "/opportunity-radar", icon: Radar },
  { title: "Scanner", description: "Find setups by strategy", url: "/scanner", icon: Search },
  { title: "Journal", description: "Positions, P&L & insights", url: "/journal", icon: BookOpen },
  { title: "User Guide", description: "How every feature works", url: "/guide", icon: HelpCircle },
  { title: "Strategy Reference", description: "Strategy details (VCP, ORB, …)", url: "/help", icon: BookOpen },
  { title: "My Limits", description: "Risk profile & guardrails", url: "/settings/risk-profile", icon: SlidersHorizontal },
  { title: "My Preferences", description: "Trading preferences", url: "/settings", icon: Settings },
];

const baseAdvancedToolsItems: NavItem[] = [
  { title: "Trade Setups", description: "Saved setup builder", url: "/trade-setups", icon: Wrench },
  { title: "Charts", description: "Technical charts", url: "/charts", icon: LineChart },
  { title: "Backtest", description: "Strategy backtests", url: "/backtest", icon: Beaker },
  { title: "Alerts", description: "Trade alerts", url: "/alerts", icon: Bell },
];

const automationNavItem: NavItem = {
  title: "Automation",
  description: "Cockpit & outcomes",
  url: "/automation",
  icon: Workflow,
};

const PERSONA_LABEL: Record<string, string> = {
  buyer: "Buyer",
  seller: "Income",
  complex: "Complex",
  learner: "Learner",
};

const PLAN_LABEL: Record<string, string> = {
  free: "Explorer",
  pro: "Trader",
  edge: "Active",
  team: "Pro Desk",
};

function SidebarBrandHeader() {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const { isConnected, providerName, status } = useBrokerStatus();
  const { persona } = usePersona();
  const { plan } = usePlan();
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
        <div className="mt-2 flex flex-wrap gap-1" data-testid="status-chips">
          <span className={cn(
            "inline-flex items-center gap-1 text-[10px] leading-none px-1.5 py-0.5 rounded-full border",
            brokerColor
          )} data-testid="badge-broker-status">
            <span className={cn("h-1.5 w-1.5 rounded-full", dotColor)} />
            {brokerLabel}
          </span>
          <Link
            href={persona ? "/settings?tab=trading-style" : "/pricing"}
            className="inline-flex items-center gap-1 text-[10px] leading-none px-1.5 py-0.5 rounded-full border border-primary/30 text-primary hover-elevate"
            data-testid="badge-plan-persona"
            title="Trading style & plan"
          >
            {PLAN_LABEL[plan] ?? "Free"}
            {persona && <span className="text-muted-foreground/70">·</span>}
            {persona && <span>{PERSONA_LABEL[persona] ?? persona}</span>}
          </Link>
        </div>
      )}
    </>
  );
}

function NavMenuItem({ item, active, onNavClick }: { item: NavItem; active: boolean; onNavClick: () => void }) {
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
          onClick={onNavClick}
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
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-medium leading-tight truncate">{item.title}</span>
            <span className={cn(
              "text-xs leading-snug line-clamp-2 whitespace-normal",
              active ? "text-sidebar-accent-foreground/70" : "text-muted-foreground"
            )}>{item.description}</span>
          </div>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const [location] = useLocation();
  const { setOpenMobile, isMobile, state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [moreOpen, setMoreOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const advancedToolsItems: NavItem[] = isAdmin
    ? [...baseAdvancedToolsItems, automationNavItem]
    : baseAdvancedToolsItems;

  const adminItems: NavItem[] = isAdmin ? [
    { title: "Admin Home", description: "All admin tools", url: "/admin", icon: LayoutDashboard },
    { title: "Users", description: "User administration", url: "/admin/users", icon: Users },
    { title: "Email Campaigns", description: "Send & track emails", url: "/admin/emails", icon: Mail },
    { title: "Sessions", description: "Login/logout audit log", url: "/admin/sessions", icon: Eye },
    { title: "Partners", description: "Signal providers", url: "/admin/partners", icon: Handshake },
    { title: "Compliance", description: "Acceptance logs", url: "/admin/disclaimer-logs", icon: Shield },
  ] : [];

  const handleNavClick = () => {
    if (isMobile) setOpenMobile(false);
  };

  const isActive = (url: string) => {
    if (url === "/home") return location === "/home";
    if (url === "/goal-mode") return location === "/goal-mode";
    if (url === "/income-mode") return location === "/income-mode";
    if (url === "/market-intel") return location === "/market-intel";
    if (url === "/scanner") return location === "/scanner" || location === "/discover";
    if (url === "/trade-finder") return location === "/trade-finder" || location === "/agent" || location.startsWith("/trade/");
    if (url === "/journal") return location === "/journal" || location === "/history" || location === "/trade-setups";
    if (url === "/settings/risk-profile") return location === "/settings/risk-profile";
    if (url === "/settings") return location === "/settings" || (location.startsWith("/settings/") && location !== "/settings/risk-profile");
    if (url === "/charts") return location === "/charts" || location.startsWith("/charts/");
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
              {mainNavItems.map((item) => (
                <NavMenuItem
                  key={item.title}
                  item={item}
                  active={isActive(item.url)}
                  onNavClick={handleNavClick}
                />
              ))}

              {!isCollapsed && (
                <SidebarMenuItem>
                  <button
                    type="button"
                    onClick={() => setMoreOpen((v) => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 mt-1 text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
                    data-testid="button-toggle-more"
                    aria-expanded={moreOpen}
                  >
                    <span>More</span>
                    {moreOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                </SidebarMenuItem>
              )}

              {!isCollapsed && moreOpen && moreNavItems.map((item) => (
                <NavMenuItem
                  key={item.title}
                  item={item}
                  active={isActive(item.url)}
                  onNavClick={handleNavClick}
                />
              ))}

              {!isCollapsed && moreOpen && (
                <SidebarMenuItem>
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen((v) => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
                    data-testid="button-toggle-advanced"
                    aria-expanded={advancedOpen}
                  >
                    <span>Advanced Tools</span>
                    {advancedOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                </SidebarMenuItem>
              )}

              {!isCollapsed && moreOpen && advancedOpen && advancedToolsItems.map((item) => (
                <NavMenuItem
                  key={item.title}
                  item={item}
                  active={isActive(item.url)}
                  onNavClick={handleNavClick}
                />
              ))}

              {isCollapsed && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/instatrade"}
                    size="lg"
                    tooltip="InstaTrade™"
                    className="h-auto py-3 bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
                  >
                    <Link
                      href="/instatrade"
                      onClick={handleNavClick}
                      data-testid="link-nav-instatrade"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/15">
                        <Zap className="h-4 w-4" />
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-sm font-medium leading-tight truncate">InstaTrade™</span>
                        <span className="text-xs leading-snug text-white/70">Place orders fast</span>
                      </div>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {isCollapsed && [...moreNavItems, ...advancedToolsItems].map((item) => (
                <NavMenuItem
                  key={item.title}
                  item={item}
                  active={isActive(item.url)}
                  onNavClick={handleNavClick}
                />
              ))}

              {adminItems.length > 0 && (
                <>
                  {!isCollapsed && (
                    <SidebarMenuItem>
                      <div className="px-3 py-2 mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                        Admin
                      </div>
                    </SidebarMenuItem>
                  )}
                  {adminItems.map((item) => (
                    <NavMenuItem
                      key={item.title}
                      item={item}
                      active={isActive(item.url)}
                      onNavClick={handleNavClick}
                    />
                  ))}
                </>
              )}
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
