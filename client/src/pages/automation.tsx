import { useState, useEffect } from "react";
import { useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bot, Rocket, FileBarChart2, Bell } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import type { Alert } from "@shared/schema";
import AutomationAgentPage from "@/pages/automation-agent";
import ExecutionCockpit from "@/pages/execution";
import OpportunitiesPage from "@/pages/opportunities";
import Alerts from "@/pages/alerts";

export default function AutomationPage() {
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const viewParam = params.get("view");

  const getInitialTab = () => {
    if (viewParam === "cockpit") return "cockpit";
    if (viewParam === "outcomes") return "outcomes";
    if (viewParam === "alerts") return "alerts";
    return "agent";
  };

  const [activeTab, setActiveTab] = useState(getInitialTab);

  const { data: alerts } = useQuery<Alert[]>({
    queryKey: ["/api/alerts"],
  });

  const unreadAlerts = alerts?.filter(a => !a.isRead).length || 0;

  useEffect(() => {
    const tab = getInitialTab();
    setActiveTab(tab);
  }, [viewParam]);

  return (
    <div className="flex flex-col h-full" data-testid="automation-page">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
        <div className="border-b px-4 pt-3">
          <TabsList data-testid="automation-tabs">
            <TabsTrigger value="agent" className="gap-2" data-testid="tab-agent">
              <Bot className="h-4 w-4" />
              Auto Agent
            </TabsTrigger>
            <TabsTrigger value="cockpit" className="gap-2" data-testid="tab-cockpit">
              <Rocket className="h-4 w-4" />
              Execution
            </TabsTrigger>
            <TabsTrigger value="outcomes" className="gap-2" data-testid="tab-outcomes">
              <FileBarChart2 className="h-4 w-4" />
              Outcomes
            </TabsTrigger>
            <TabsTrigger value="alerts" className="gap-2" data-testid="tab-alerts">
              <Bell className="h-4 w-4" />
              Alerts
              {unreadAlerts > 0 && (
                <Badge variant="destructive" className="ml-1 text-xs h-5 min-w-5 px-1.5">
                  {unreadAlerts}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="agent" className="flex-1 mt-0 overflow-auto">
          <AutomationAgentPage />
        </TabsContent>

        <TabsContent value="cockpit" className="flex-1 mt-0 overflow-auto">
          <ExecutionCockpit />
        </TabsContent>

        <TabsContent value="outcomes" className="flex-1 mt-0 overflow-auto">
          <OpportunitiesPage />
        </TabsContent>

        <TabsContent value="alerts" className="flex-1 mt-0 overflow-auto">
          <Alerts />
        </TabsContent>
      </Tabs>
    </div>
  );
}
