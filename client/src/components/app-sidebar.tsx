import { Link, useLocation } from "wouter";
import {
  Search,
  Settings,
  Wifi,
  WifiOff,
  Newspaper,
  Target,
  Bot,
  Radio,
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
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import type { BrokerConnection } from "@shared/schema";

interface NavItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  { title: "Dashboard", url: "/command-center", icon: Target },
  { title: "Discover", url: "/discover", icon: Search },
  { title: "Automation", url: "/automation", icon: Bot },
  { title: "News", url: "/news", icon: Newspaper },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { setOpenMobile, isMobile } = useSidebar();

  const { data: brokerStatus } = useQuery<BrokerConnection | null>({
    queryKey: ["/api/broker/status"],
  });

  const isConnected = brokerStatus?.isConnected ?? false;

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
    <Sidebar>
      <SidebarHeader className="p-3">
        <Link href="/command-center" onClick={handleNavClick} data-testid="link-home">
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
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.url)}
                  >
                    <Link
                      href={item.url}
                      onClick={handleNavClick}
                      data-testid={`link-nav-${item.title.toLowerCase()}`}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
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
