import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, ArrowRight, HelpCircle, Sparkles } from "lucide-react";

interface Setup {
  ticker: string;
  strategy: string;
  daysLeft: number;
  score: number;
  winProb: number;
  maxProfit: number;
  maxLoss: number;
  reason: string;
  best?: boolean;
}

const MOCK_SETUPS: Setup[] = [
  { ticker: "XLE",  strategy: "Iron condor",     daysLeft: 32, score: 94, winProb: 71, maxProfit: 340, maxLoss: 160, reason: "Range-bound · IV rank 78", best: true },
  { ticker: "MU",   strategy: "Bear call spread", daysLeft: 18, score: 87, winProb: 68, maxProfit: 280, maxLoss: 220, reason: "Resistance + falling momentum" },
  { ticker: "META", strategy: "Put credit spread", daysLeft: 25, score: 84, winProb: 66, maxProfit: 180, maxLoss: 320, reason: "Strong support holding · Volume" },
  { ticker: "AAPL", strategy: "Covered call",     daysLeft: 11, score: 79, winProb: 64, maxProfit: 120, maxLoss: 80,  reason: "Sideways action · Premium rich" },
];

export default function ResultsPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const sp = new URLSearchParams(search);
  const initialQ = sp.get("q") || "Show me iron condor setups";
  const [followUp, setFollowUp] = useState("");

  const submitFollowUp = (text: string) => {
    if (!text.trim()) return;
    navigate(`/results?q=${encodeURIComponent(text.trim())}`);
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-8 space-y-6">
        <div className="flex justify-end">
          <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[80%] text-sm" data-testid="text-query-echo">
            {initialQ}
          </div>
        </div>

        <Card className="p-5 bg-muted/30 border-dashed">
          <div className="flex items-start gap-3">
            <Sparkles className="h-4 w-4 text-violet-700 mt-0.5 shrink-0" />
            <p className="text-sm text-foreground/90" data-testid="text-ai-intro">
              I found {MOCK_SETUPS.length} candidate setups that match. The strongest is a 32-day iron
              condor on XLE — IV is elevated and the underlying has been range-bound. The other three
              are defined-risk credit spreads with similar themes.
            </p>
          </div>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {MOCK_SETUPS.map((s) => (
            <Card
              key={s.ticker}
              className={"p-5 " + (s.best ? "ring-2 ring-violet-500" : "")}
              data-testid={`card-setup-${s.ticker}`}
            >
              {s.best && (
                <Badge className="bg-violet-100 text-violet-800 border-violet-200 hover:bg-violet-100 mb-2">
                  Best match
                </Badge>
              )}
              <div className="flex items-center justify-between">
                <div className="text-lg font-medium">{s.ticker}</div>
                <Badge variant="outline" className="bg-emerald-50 text-emerald-800 border-emerald-200">
                  Score {s.score}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-1">{s.strategy} · {s.daysLeft} days</div>

              <div className="grid grid-cols-3 gap-2 mt-4">
                <Chip label="Win prob" value={`${s.winProb}%`} />
                <Chip label="Max profit" value={`$${s.maxProfit}`} tone="green" />
                <Chip label="Max loss" value={`$${s.maxLoss}`} tone="red" />
              </div>

              <p className="text-sm text-foreground/80 mt-4 leading-snug">{s.reason}</p>

              <div className="flex items-center justify-between mt-5 pt-4 border-t">
                <Link href={`/trade/${s.ticker}`}>
                  <Button size="sm" className="gap-1" data-testid={`button-see-trade-${s.ticker}`}>
                    See full trade <ArrowRight className="h-3 w-3" />
                  </Button>
                </Link>
                <Button size="sm" variant="ghost" className="gap-1 text-muted-foreground">
                  <HelpCircle className="h-3 w-3" /> What is this?
                </Button>
              </div>
            </Card>
          ))}
        </div>

        <div className="relative">
          <Search className="h-4 w-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitFollowUp(followUp)}
            placeholder="Ask a follow-up or refine..."
            className="h-12 pl-11 pr-20 rounded-[14px]"
            data-testid="input-followup"
          />
          <Button
            onClick={() => submitFollowUp(followUp)}
            className="absolute right-2 top-1.5 h-9 rounded-[10px] gap-1"
            data-testid="button-followup"
          >
            Ask <ArrowRight className="h-3 w-3" />
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            "Max loss under $200",
            "Beginner-friendly only",
            "For a $5k account",
            `Walk me through ${MOCK_SETUPS[0].ticker}`,
          ].map((p) => (
            <button
              key={p}
              onClick={() => submitFollowUp(p)}
              className="rounded-full border border-border bg-muted/40 hover:bg-muted text-sm px-3.5 py-1.5"
              data-testid={`pill-followup-${p.slice(0, 10).toLowerCase().replace(/\s+/g, "-")}`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Chip({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  const color =
    tone === "green" ? "text-emerald-700" : tone === "red" ? "text-rose-700" : "text-foreground";
  return (
    <div className="bg-muted/40 rounded-md p-2">
      <div className="text-[10px] uppercase text-muted-foreground tracking-wide">{label}</div>
      <div className={`text-sm font-medium mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}
