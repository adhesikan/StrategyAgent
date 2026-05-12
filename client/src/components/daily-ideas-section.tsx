import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";
import { DailyIdeaCard, type DailyIdea } from "@/components/daily-idea-card";

interface IdeasResponse {
  ideas: DailyIdea[];
  brokerConnected: boolean;
  dataMode: "live" | "simulated" | "mixed";
  liveQuoteCount?: number;
  quoteFetchError?: string | null;
  asOf: string;
  disclaimer: string;
}

interface Props {
  bucket: "all" | "growth" | "income" | "stocks" | "options" | "watchlist" | "beginner";
  title: string;
  subtitle?: string;
  limit?: number;
  emptyText?: string;
}

export function DailyIdeasSection({ bucket, title, subtitle, limit = 6, emptyText }: Props) {
  const { data, isLoading } = useQuery<IdeasResponse>({
    queryKey: ["/api/daily-ideas", { bucket }],
    queryFn: async () => {
      const r = await fetch(`/api/daily-ideas?bucket=${bucket}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load ideas");
      return r.json();
    },
  });

  return (
    <section className="space-y-3" data-testid={`section-ideas-${bucket}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            {title}
          </h2>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {data?.dataMode === "simulated" && (
          <Badge variant="outline" className="text-[10px]">Simulated data</Badge>
        )}
      </div>
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-56 rounded-lg" />
          ))}
        </div>
      ) : data && data.ideas.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.ideas.slice(0, limit).map((idea) => (
            <DailyIdeaCard key={idea.id} idea={idea} />
          ))}
        </div>
      ) : (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          {emptyText ?? "No ideas in this category right now."}
        </Card>
      )}
    </section>
  );
}
