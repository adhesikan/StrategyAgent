import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  Search,
  BarChart3,
  Bell,
  List,
  FlaskConical,
  Settings,
  Wifi,
  WifiOff,
  Zap,
  BookOpen,
  Rocket,
  FileBarChart2,
  ChevronDown,
  Star,
  Radio,
  Newspaper,
  Target,
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
  useSidebar,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import type { BrokerConnection, Alert } from "@shared/schema";

interface NavItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  showStartHere?: boolean;
}

interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
  defaultExpanded?: boolean;
}

const navSections: NavSection[] = [
  {
    id: "hub",
    label: "Hub",
    defaultExpanded: true,
    items: [
      { title: "Command Center", url: "/command-center", icon: Target },
    ],
  },
  {
    id: "discover",
    label: "Discover",
    defaultExpanded: true,
    items: [
      { title: "Opportunity Radar", url: "/", icon: Search, showStartHere: true },
      { title: "Breakout Alerts", url: "/signals", icon: Zap },
      { title: "Watchlists", url: "/watchlists", icon: List },
    ],
  },
  {
    id: "analyze",
    label: "Analyze",
    defaultExpanded: false,
    items: [
      { title: "Charts", url: "/charts", icon: BarChart3 },
      { title: "Backtest", url: "/backtest", icon: FlaskConical },
      { title: "Trade Outcomes", url: "/opportunities", icon: FileBarChart2 },
    ],
  },
  {
    id: "execute",
    label: "Execute",
    defaultExpanded: false,
    items: [
      { title: "Execution Cockpit", url: "/execution", icon: Rocket },
      { title: "Alerts", url: "/alerts", icon: Bell },
    ],
  },
  {
    id: "learn",
    label: "Learn",
    defaultExpanded: false,
    items: [
      { title: "How This Works", url: "/strategy-guide", icon: BookOpen },
      { title: "News & Research", url: "/learn/news", icon: Newspaper },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    defaultExpanded: false,
    items: [
      { title: "Settings", url: "/settings", icon: Settings },
    ],
  },
];

function getStorageKey(sectionId: string): string {
  return `vcp_nav_section_${sectionId}`;
}

function getInitialExpandState(): Record<string, boolean> {
  if (typeof window === "undefined") {
    return {};
  }

  const state: Record<string, boolean> = {};
  let hasStoredPreferences = false;

  navSections.forEach((section) => {
    const stored = localStorage.getItem(getStorageKey(section.id));
    if (stored !== null) {
      hasStoredPreferences = true;
      state[section.id] = stored === "true";
    }
  });

  if (!hasStoredPreferences) {
    navSections.forEach((section) => {
      state[section.id] = section.defaultExpanded ?? false;
    });
  } else {
    navSections.forEach((section) => {
      if (state[section.id] === undefined) {
        state[section.id] = section.defaultExpanded ?? false;
      }
    });
  }

  return state;
}

function getInitialStartHereSeen(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem("vcp_start_here_seen") === "true";
}

export function AppSidebar() {
  const [location] = useLocation();
  const { setOpenMobile, isMobile } = useSidebar();
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(getInitialExpandState);
  const [startHereSeen, setStartHereSeen] = useState<boolean>(getInitialStartHereSeen);

  const { data: brokerStatus } = useQuery<BrokerConnection | null>({
    queryKey: ["/api/broker/status"],
  });

  const { data: alerts } = useQuery<Alert[]>({
    queryKey: ["/api/alerts"],
  });

  const unreadAlerts = alerts?.filter(a => !a.isRead).length || 0;
  const isConnected = brokerStatus?.isConnected ?? false;

  const handleNavClick = (item: NavItem) => {
    if (isMobile) {
      setOpenMobile(false);
    }
    if (item.showStartHere && !startHereSeen) {
      setStartHereSeen(true);
      localStorage.setItem("vcp_start_here_seen", "true");
    }
  };

  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => {
      const newState = { ...prev, [sectionId]: !prev[sectionId] };
      localStorage.setItem(getStorageKey(sectionId), String(newState[sectionId]));
      return newState;
    });
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
    <Sidebar>
      <SidebarHeader className="p-3">
        <Link href="/" onClick={() => handleNavClick({ title: "", url: "/", icon: Search })} data-testid="link-home">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="VCP Trader" className="h-7 w-auto" />
            <div className="flex flex-col">
              <span className="font-semibold text-sm leading-tight">VCP Trader</span>
              <span className="text-[10px] text-muted-foreground leading-tight">by Sunfish Technologies</span>
            </div>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2">
        {navSections.map((section) => {
          const isExpanded = expandedSections[section.id] ?? section.defaultExpanded ?? false;
          const hasActiveItem = section.items.some(
            (item) => location === item.url || (item.url === "/" && location === "/scanner")
          );

          return (
            <SidebarGroup key={section.id} className="py-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggleSection(section.id)}
                className={cn(
                  "w-full justify-between gap-2 text-xs font-medium uppercase tracking-wide",
                  hasActiveItem && !isExpanded && "bg-accent/50"
                )}
                data-testid={`button-nav-section-${section.id}`}
              >
                <span>{section.label}</span>
                <ChevronDown
                  className={cn(
                    "h-3 w-3 transition-transform duration-200",
                    isExpanded && "rotate-180"
                  )}
                />
              </Button>
              {isExpanded && (
                <SidebarGroupContent className="mt-1">
                  <SidebarMenu>
                    {section.items.map((item) => {
                      const isActive = location === item.url || (item.url === "/" && location === "/scanner");
                      const showStartHereIndicator = item.showStartHere && !startHereSeen;

                      return (
                        <SidebarMenuItem key={item.title}>
                          <SidebarMenuButton
                            asChild
                            isActive={isActive}
                          >
                            <Link
                              href={item.url}
                              onClick={() => handleNavClick(item)}
                              data-testid={`link-nav-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
                            >
                              <item.icon className="h-4 w-4" />
                              <span className="flex-1">{item.title}</span>
                              {item.title === "Alerts" && unreadAlerts > 0 && (
                                <Badge variant="destructive" className="ml-auto text-xs h-5 min-w-5 px-1.5">
                                  {unreadAlerts}
                                </Badge>
                              )}
                              {showStartHereIndicator && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="ml-auto flex items-center gap-1">
                                      <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                                      <span className="text-[10px] text-yellow-600 dark:text-yellow-400 font-medium">
                                        Start here
                                      </span>
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="right" className="text-xs">
                                    Start here to find live setups
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              )}
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter className="p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Radio className={cn(
            "h-3 w-3",
            isMarketHours() ? "text-green-500" : "text-muted-foreground"
          )} />
          <span>{isMarketHours() ? "Live Scan Active" : "Market Closed"}</span>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-sidebar-accent/50 p-2">
          {isConnected ? (
            <Wifi className="h-4 w-4 text-status-online" />
          ) : (
            <WifiOff className="h-4 w-4 text-muted-foreground" />
          )}
          <div className="flex flex-col">
            <span className="text-xs font-medium">
              {isConnected ? "Broker Connected" : "No Broker"}
            </span>
            {isConnected && brokerStatus?.provider && (
              <span className="text-[10px] text-muted-foreground">
                {brokerStatus.provider}
              </span>
            )}
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
