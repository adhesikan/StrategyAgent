import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  Bot,
  BookOpen,
  Zap,
  Link2,
  Clock,
  Loader2,
  Send,
  Eye,
  FileText,
} from "lucide-react";

interface ActivityLogItem {
  id: string;
  eventType: string;
  description: string;
  metadataJson: any;
  createdAt: string;
}

const eventIcons: Record<string, any> = {
  setup_generated: Bot,
  strategy_created: BookOpen,
  strategy_updated: BookOpen,
  setup_reviewed: Eye,
  sent_to_instatrade: Zap,
  broker_connected: Link2,
  prompt_submitted: Send,
};

const eventColors: Record<string, string> = {
  setup_generated: "bg-blue-500/15 text-blue-400",
  strategy_created: "bg-green-500/15 text-green-400",
  strategy_updated: "bg-amber-500/15 text-amber-400",
  setup_reviewed: "bg-purple-500/15 text-purple-400",
  sent_to_instatrade: "bg-primary/15 text-primary",
  broker_connected: "bg-green-500/15 text-green-400",
  prompt_submitted: "bg-blue-500/15 text-blue-400",
};

export default function ActivityPage() {
  const { data: logs, isLoading } = useQuery<ActivityLogItem[]>({
    queryKey: ["/api/agent/activity"],
  });

  return (
    <div className="flex-1 p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <Activity className="h-6 w-6 text-primary" />
          Activity
        </h1>
        <p className="text-sm text-muted-foreground" data-testid="text-page-subtitle">
          Your activity history and event log
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !logs || logs.length === 0 ? (
        <Card className="border-dashed" data-testid="card-empty">
          <CardContent className="py-12 text-center space-y-3">
            <Activity className="h-10 w-10 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">
              No activity yet. Start by generating a setup on the Agent page.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => {
            const IconComp = eventIcons[log.eventType] || FileText;
            const colorClass = eventColors[log.eventType] || "bg-muted text-muted-foreground";

            return (
              <Card key={log.id} className="bg-card/80" data-testid={`card-activity-${log.id}`}>
                <CardContent className="py-3">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${colorClass}`}>
                      <IconComp className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" data-testid={`text-activity-desc-${log.id}`}>
                        {log.description}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {log.eventType.replace(/_/g, " ")}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                          <Clock className="h-3 w-3" />
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
