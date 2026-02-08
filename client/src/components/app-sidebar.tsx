import { Link, useLocation } from "wouter";
import {
  Search,
  Settings,
  Newspaper,
  Target,
  Bot,
  Radio,
  ChevronsLeft,
  ChevronsRight,
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
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface NavItem {
  title: string;
  description: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  { title: "Dashboard", description: "Overview & positions", url: "/command-center", icon: Target },
  { title: "Discover", description: "Scan & explore", url: "/discover", icon: Search },
  { title: "Automation", description: "Agents & alerts", url: "/automation", icon: Bot },
  { title: "News", description: "Market headlines", url: "/news", icon: Newspaper },
  { title: "Settings", description: "Account & config", url: "/settings", icon: Settings },
];

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
    if (url === "/command-center") return location === "/command-center";
    if (url === "/discover") {
      return location === "/discover" || location === "/" || location === "/scanner" || location === "/signals" || location === "/watchlists" || location === "/app/stocks" || location === "/app/options" || location === "/charts" || location.startsWith("/charts/");
    }
    if (url === "/automation") {
      return location === "/automation" || location === "/app/automation" || location === "/execution" || location === "/opportunities" || location === "/alerts";
    }
    if (url === "/news") return location === "/news" || location === "/learn/news";
    if (url === "/settings") {
      return location === "/settings" || location.startsWith("/settings/") || location === "/help";
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
        <Link href="/command-center" onClick={handleNavClick} data-testid="link-home">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="VCP Trader" className="h-7 w-7 shrink-0 object-contain" />
            <div className="flex flex-col overflow-hidden group-data-[collapsible=icon]:hidden">
              <span className="font-semibold text-sm leading-tight truncate">VCP Trader</span>
              <span className="text-[10px] text-muted-foreground leading-tight truncate">by Sunfish Technologies</span>
            </div>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2 group-data-[collapsible=icon]:px-1">
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <SidebarMenu className="gap-2">
              {navItems.map((item) => {
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
