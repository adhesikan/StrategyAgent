import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Activity, Bot, Check, X, AlertTriangle, Play, Info } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface AgentDecision {
  id: string;
  userId: string;
  policyId: string;
  opportunityId: string | null;
  symbol: string;
  action: string;
  reasons: string[] | null;
  metricsSnapshot: {
    confidence?: number;
    price?: number;
    resistance?: number;
    stop?: number;
    rvol?: number;
    upsidePct?: number;
    riskPct?: number;
    rewardRisk?: number;
  } | null;
  createdAt: string;
}

interface AgentActivityProps {
  limit?: number;
  showCard?: boolean;
}

export function AgentActivity({ limit = 50, showCard = true }: AgentActivityProps) {
  const { data: decisions, isLoading } = useQuery<AgentDecision[]>({
    queryKey: ["/api/agent/decisions", limit],
  });

  const getActionBadge = (action: string) => {
    switch (action) {
      case "EXECUTE":
        return <Badge className="bg-green-600" data-testid={`badge-action-${action}`}><Check className="h-3 w-3 mr-1" /> Executed</Badge>;
      case "SUGGEST":
        return <Badge variant="secondary" data-testid={`badge-action-${action}`}><Play className="h-3 w-3 mr-1" /> Suggested</Badge>;
      case "SKIP":
        return <Badge variant="outline" data-testid={`badge-action-${action}`}><X className="h-3 w-3 mr-1" /> Skipped</Badge>;
      case "ERROR":
        return <Badge variant="destructive" data-testid={`badge-action-${action}`}><AlertTriangle className="h-3 w-3 mr-1" /> Error</Badge>;
      default:
        return <Badge variant="outline">{action}</Badge>;
    }
  };

  const content = (
    <div className="space-y-2">
      {isLoading ? (
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-muted rounded" />
          ))}
        </div>
      ) : !decisions || decisions.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Bot className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No agent decisions yet</p>
          <p className="text-sm">Enable the Auto Agent to start seeing activity</p>
        </div>
      ) : (
        <ScrollArea className="h-[400px]">
          <div className="space-y-2 pr-4">
            {decisions.map((decision) => (
              <div
                key={decision.id}
                className="p-3 rounded-lg border bg-card hover-elevate"
                data-testid={`decision-${decision.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm">{decision.symbol}</span>
                      {getActionBadge(decision.action)}
                    </div>
                    {decision.reasons && decision.reasons.length > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="text-xs text-muted-foreground truncate cursor-help">
                            {decision.reasons[0]}
                            {decision.reasons.length > 1 && ` (+${decision.reasons.length - 1} more)`}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-xs">
                          <ul className="text-xs space-y-1">
                            {decision.reasons.map((reason, i) => (
                              <li key={i}>{reason}</li>
                            ))}
                          </ul>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {decision.metricsSnapshot && (
                      <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                        {decision.metricsSnapshot.price && (
                          <span>${decision.metricsSnapshot.price.toFixed(2)}</span>
                        )}
                        {decision.metricsSnapshot.upsidePct !== undefined && (
                          <span>Upside: {decision.metricsSnapshot.upsidePct.toFixed(1)}%</span>
                        )}
                        {decision.metricsSnapshot.rewardRisk !== undefined && (
                          <span>R:R {decision.metricsSnapshot.rewardRisk.toFixed(2)}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(new Date(decision.createdAt), { addSuffix: true })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );

  if (!showCard) {
    return content;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          <CardTitle className="text-base font-medium">Agent Activity</CardTitle>
        </div>
        <CardDescription>
          Recent decisions made by the Auto Agent
        </CardDescription>
      </CardHeader>
      <CardContent>
        {content}
      </CardContent>
    </Card>
  );
}

export function AgentEligibilityBadge({ 
  opportunityId, 
  symbol 
}: { 
  opportunityId: string;
  symbol: string;
}) {
  const { data: evaluation, isLoading } = useQuery<{
    eligible: boolean;
    reasons: string[];
    authorized: boolean;
    authorizationReasons: string[];
  }>({
    queryKey: ["/api/agent/evaluate", opportunityId],
    enabled: !!opportunityId,
    staleTime: 60000,
  });

  if (isLoading) {
    return null;
  }

  if (!evaluation) {
    return null;
  }

  const allReasons = [...(evaluation.reasons || []), ...(evaluation.authorizationReasons || [])];

  if (evaluation.eligible && evaluation.authorized) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="outline" 
            className="text-xs border-green-500 text-green-500"
            data-testid={`badge-agent-eligible-${symbol}`}
          >
            <Bot className="h-3 w-3 mr-1" />
            Eligible
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">This opportunity passes all agent criteria</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge 
          variant="outline" 
          className="text-xs"
          data-testid={`badge-agent-skipped-${symbol}`}
        >
          <X className="h-3 w-3 mr-1" />
          Skipped
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="text-xs font-medium mb-1">Skip Reasons:</p>
        <ul className="text-xs space-y-1">
          {allReasons.map((reason, i) => (
            <li key={i}>{reason}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
