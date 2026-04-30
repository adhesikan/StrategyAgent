import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Newspaper, Sparkles, Zap, Eye, Landmark, Flame } from "lucide-react";
import { ComplianceFooter } from "@/components/trading-shell";

interface MarketIntelCardProps {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  placeholders: { headline: string; body: string; tag?: string }[];
  testId: string;
}

function MarketIntelCard({ title, icon: Icon, description, placeholders, testId }: MarketIntelCardProps) {
  return (
    <Card data-testid={testId} className="hover-elevate transition-all">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {placeholders.map((p, i) => (
          <div key={i} className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium leading-tight">{p.headline}</div>
              {p.tag && <Badge variant="outline" className="text-[10px] shrink-0">{p.tag}</Badge>}
            </div>
            <p className="text-xs text-muted-foreground leading-snug">{p.body}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function MarketIntelPage() {
  return (
    <div className="flex-1 p-4 md:p-6 max-w-6xl mx-auto w-full space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <Newspaper className="h-6 w-6 text-amber-400" />
          Market Intel
        </h1>
        <p className="text-sm text-muted-foreground">
          AI summaries of market news, catalysts, and watchlist impact.
        </p>
      </div>

      {/* TODO: Wire to existing stock news API (server/services/news-provider) and congress flow data feed. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MarketIntelCard
          testId="card-morning-briefing"
          title="Morning Briefing"
          icon={Sparkles}
          description="What you need to know before the bell."
          placeholders={[
            {
              headline: "Futures mixed ahead of CPI release",
              body: "Pre-market action is muted as traders await the 8:30 ET inflation print. Rate-sensitive names are flat.",
              tag: "Macro",
            },
            {
              headline: "Earnings highlight: 3 megacaps after the close",
              body: "Implied moves are above 4% for each name. Position sizing matters into print.",
              tag: "Earnings",
            },
          ]}
        />
        <MarketIntelCard
          testId="card-why-moving"
          title="Why Is It Moving?"
          icon={Zap}
          description="One-line explanations for unusual price action."
          placeholders={[
            {
              headline: "AMD +4.2% — analyst upgrade and AI capex commentary",
              body: "An overnight upgrade plus a reaffirmed AI roadmap explain the gap up.",
              tag: "AMD",
            },
            {
              headline: "XLE -1.8% — crude weakness on inventory build",
              body: "Energy sector is selling off after a larger-than-expected inventory build.",
              tag: "Sector",
            },
          ]}
        />
        <MarketIntelCard
          testId="card-watchlist-impact"
          title="Watchlist Impact"
          icon={Eye}
          description="How today's news affects names on your watchlist."
          placeholders={[
            {
              headline: "AAPL on watchlist — supply chain headline noted",
              body: "An overnight Bloomberg item flags supplier capacity. No firm guidance change yet.",
              tag: "Watchlist",
            },
          ]}
        />
        <MarketIntelCard
          testId="card-congress-flow"
          title="Congress Flow"
          icon={Landmark}
          description="Recent congressional disclosures relevant to your symbols."
          placeholders={[
            {
              headline: "No new disclosures in the last 24 hours",
              body: "We'll surface relevant filings here when they impact your watchlist.",
            },
          ]}
        />
        <MarketIntelCard
          testId="card-top-catalysts"
          title="Top Catalysts"
          icon={Flame}
          description="Upcoming catalysts that historically move price."
          placeholders={[
            {
              headline: "FOMC minutes — Wed 2:00 ET",
              body: "Watch for tone changes that could swing rate-sensitive names.",
              tag: "Macro",
            },
            {
              headline: "NVDA earnings — next Wed AMC",
              body: "Implied move is approximately 7%. Defined-risk strategies are common into print.",
              tag: "Earnings",
            },
          ]}
        />
      </div>

      <ComplianceFooter />
    </div>
  );
}
