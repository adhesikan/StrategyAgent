import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import {
  Layers,
  BarChart3,
  Clock,
  ArrowRight,
  Loader2,
} from "lucide-react";

interface BuiltInStrategy {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  timeframes: string[];
}

const categoryColors: Record<string, string> = {
  intraday: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  swing: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  breakout: "bg-green-500/15 text-green-400 border-green-500/30",
};

export default function StrategiesPage() {
  const [, navigate] = useLocation();
  const { data: strategies, isLoading } = useQuery<BuiltInStrategy[]>({
    queryKey: ["/api/agent/strategies"],
  });

  return (
    <div className="flex-1 p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <Layers className="h-6 w-6 text-primary" />
          Built-In Strategies
        </h1>
        <p className="text-sm text-muted-foreground" data-testid="text-page-subtitle">
          Pre-built strategy templates for generating trade setups
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {strategies?.map((s) => (
            <Card key={s.id} className="bg-card/80 hover:border-primary/30 transition-colors" data-testid={`card-strategy-${s.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{s.displayName}</CardTitle>
                    <CardDescription className="text-xs mt-1">{s.description}</CardDescription>
                  </div>
                  <Badge variant="outline" className={`text-[10px] ${categoryColors[s.category] || ""}`} data-testid={`badge-category-${s.id}`}>
                    {s.category}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    Timeframes: {s.timeframes.join(", ")}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => navigate(`/agent?strategy=${s.id}`)}
                  data-testid={`button-use-strategy-${s.id}`}
                >
                  Use Strategy
                  <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/60 text-center" data-testid="text-disclaimer">
        Software-generated setup for informational purposes only. Not investment advice or a recommendation.
      </p>
    </div>
  );
}
