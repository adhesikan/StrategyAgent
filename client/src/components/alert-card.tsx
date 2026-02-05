import { formatDistanceToNow } from "date-fns";
import { TrendingUp, TrendingDown, AlertTriangle, Target, X, ExternalLink, Bot } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Alert, AlertTypeValue } from "@shared/schema";

interface AlertCardProps {
  alert: Alert;
  onDismiss?: (id: string) => void;
}

function getAlertIcon(type: AlertTypeValue) {
  switch (type) {
    case "BREAKOUT":
      return <TrendingUp className="h-4 w-4" />;
    case "STOP_HIT":
      return <TrendingDown className="h-4 w-4" />;
    case "EMA_EXIT":
      return <AlertTriangle className="h-4 w-4" />;
    case "APPROACHING":
      return <Target className="h-4 w-4" />;
    default:
      return <TrendingUp className="h-4 w-4" />;
  }
}

function getAlertBadgeVariant(type: AlertTypeValue): "default" | "secondary" | "destructive" | "outline" {
  switch (type) {
    case "BREAKOUT":
      return "default";
    case "STOP_HIT":
      return "destructive";
    case "EMA_EXIT":
      return "secondary";
    case "APPROACHING":
      return "outline";
    default:
      return "outline";
  }
}

function getAlertColor(type: AlertTypeValue): string {
  switch (type) {
    case "BREAKOUT":
      return "text-chart-2";
    case "STOP_HIT":
      return "text-destructive";
    case "EMA_EXIT":
      return "text-chart-4";
    case "APPROACHING":
      return "text-chart-1";
    default:
      return "text-foreground";
  }
}

export function AlertCard({ alert, onDismiss }: AlertCardProps) {
  const timeAgo = alert.triggeredAt
    ? formatDistanceToNow(new Date(alert.triggeredAt), { addSuffix: true })
    : "";

  return (
    <Card 
      className={`relative overflow-visible ${!alert.isRead ? "border-primary/30" : ""}`}
      data-testid={`alert-card-${alert.id}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge variant={getAlertBadgeVariant(alert.type as AlertTypeValue)} className="gap-1">
              {getAlertIcon(alert.type as AlertTypeValue)}
              {alert.type.replace("_", " ")}
            </Badge>
            {!alert.isRead && (
              <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
            )}
          </div>
          {onDismiss && (
            <Button
              variant="ghost"
              size="icon"
              className="-mr-1 -mt-1"
              onClick={(e) => {
                e.stopPropagation();
                onDismiss(alert.id);
              }}
              data-testid={`button-dismiss-${alert.id}`}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-lg font-semibold font-mono">
            {alert.ticker}
          </span>
          {alert.price != null && (
            <span className={`text-lg font-mono font-semibold ${getAlertColor(alert.type as AlertTypeValue)}`}>
              ${alert.price.toFixed(2)}
            </span>
          )}
        </div>

        {alert.message && (
          <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
            {alert.message}
          </p>
        )}

        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {timeAgo}
          </span>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/execution?tab=agent">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="gap-1 text-xs"
                    data-testid={`button-auto-agent-${alert.id}`}
                  >
                    <Bot className="h-3 w-3" />
                    Auto Agent
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent>
                Configure Auto Trading Agent
              </TooltipContent>
            </Tooltip>
            <Link href={`/charts/${alert.ticker}`}>
              <Button variant="ghost" size="sm" className="gap-1 text-xs" data-testid={`button-view-chart-${alert.id}`}>
                <ExternalLink className="h-3 w-3" />
                View Chart
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function AlertList({ 
  alerts, 
  onDismiss 
}: { 
  alerts: Alert[]; 
  onDismiss?: (id: string) => void;
}) {
  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <AlertTriangle className="h-10 w-10 text-muted-foreground/50 mb-3" />
        <p className="text-sm font-medium">No alerts yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Alerts will appear here when triggered
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="alert-list">
      {alerts.map((alert) => (
        <AlertCard 
          key={alert.id} 
          alert={alert} 
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}
