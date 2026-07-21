// Homepage "Daily Opportunities" section — rendered ONLY for users the
// backend authorizes (admins / internal testers / allowlisted emails during
// prelaunch). Hidden entirely on 403; external users never see placeholders.

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { DataAttribution } from "@/components/data-attribution";
import { CalendarDays, ArrowRight } from "lucide-react";

interface DailyOpportunitiesResponse {
  modeLabel?: string;
  disclosure: string;
  opportunities: Array<{
    id: string;
    symbol: string;
    setupType: string | null;
    compositeScore: number;
    compositeGrade: string;
    marketDataAsOf: string;
    conditionsPassed: string[];
    conditionsFailed: string[];
    strengths: string[];
    risks: string[];
  }>;
}

export function DailyOpportunities() {
  const { data, error } = useQuery<DailyOpportunitiesResponse>({
    queryKey: ["/api/daily-analysis/opportunities"],
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  // Not authorized (prelaunch) or no data — render nothing.
  if (error || !data || data.opportunities.length === 0) return null;

  return (
    <section className="space-y-3" data-testid="section-daily-opportunities">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-medium">Daily Opportunities</h2>
          <p className="text-xs text-muted-foreground">
            {data.modeLabel ?? "Historical daily analysis"}
          </p>
        </div>
        <Link href="/daily-analysis">
          <Button variant="ghost" size="sm" data-testid="button-view-daily-analysis">
            View all <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {data.opportunities.slice(0, 3).map((o) => (
          <Card key={o.id} data-testid={`card-home-daily-${o.symbol}`}>
            <CardContent className="p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{o.symbol}</span>
                <Badge variant="secondary">{o.compositeGrade} · {o.compositeScore}</Badge>
              </div>
              {o.setupType && <div className="text-xs text-muted-foreground">{o.setupType}</div>}
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <CalendarDays className="h-3 w-3" /> Data through {o.marketDataAsOf}
              </div>
              <div className="text-xs">
                {o.conditionsPassed.length}/{o.conditionsPassed.length + o.conditionsFailed.length} conditions passed
              </div>
              {o.strengths[0] && <p className="text-xs text-emerald-600 dark:text-emerald-400 line-clamp-1">+ {o.strengths[0]}</p>}
              {o.risks[0] && <p className="text-xs text-amber-600 dark:text-amber-400 line-clamp-1">! {o.risks[0]}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
      <DataAttribution />
    </section>
  );
}
