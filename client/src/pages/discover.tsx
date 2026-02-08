import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, ScanLine } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import Scanner from "@/pages/scanner";
import OptionsScanner from "@/pages/options-scanner";

interface MeResponse {
  user: { id: string; email: string; role: string };
  entitlements: {
    stockScanner: boolean;
    optionsScanner: boolean;
    automation: boolean;
    plan: string;
  };
  broker: { connected: boolean; provider: string | null };
}

export default function DiscoverPage() {
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const tabParam = params.get("tab");

  const [activeTab, setActiveTab] = useState(tabParam === "options" ? "options" : "stocks");

  const { data: me } = useQuery<MeResponse>({
    queryKey: ["/api/auth/me"],
  });

  const hasOptions = me?.entitlements?.optionsScanner ?? false;

  useEffect(() => {
    if (tabParam === "options" && hasOptions) {
      setActiveTab("options");
    } else if (tabParam === "stocks") {
      setActiveTab("stocks");
    }
  }, [tabParam, hasOptions]);

  return (
    <div className="flex flex-col h-full" data-testid="discover-page">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
        <div className="border-b px-4 pt-3">
          <TabsList data-testid="discover-tabs">
            <TabsTrigger value="stocks" className="gap-2" data-testid="tab-stocks">
              <Search className="h-4 w-4" />
              Stocks
            </TabsTrigger>
            {hasOptions && (
              <TabsTrigger value="options" className="gap-2" data-testid="tab-options">
                <ScanLine className="h-4 w-4" />
                Options
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <TabsContent value="stocks" className="flex-1 mt-0 overflow-auto">
          <Scanner />
        </TabsContent>

        {hasOptions && (
          <TabsContent value="options" className="flex-1 mt-0 overflow-auto">
            <OptionsScanner />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
