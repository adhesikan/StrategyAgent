import { useEffect, useMemo, useState } from "react";
import { useLocation, Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, ArrowRight, ArrowLeft, AlertTriangle, CheckCircle2, Loader2, Search } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { ComplianceFooter } from "@/components/trading-shell";

interface AskResponse {
  question: string;
  intent: string;
  tickers: string[];
  brokerConnected: boolean;
  headline: string;
  answer: string;
  keyPoints: string[];
  riskNote: string;
  confidence: "low" | "medium" | "high";
  suggestions: { label: string; href: string }[];
  source: "openai" | "rule_based";
  disclaimer: string;
}

const CONFIDENCE_TONE: Record<string, string> = {
  high: "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
  medium: "border-sky-500/40 text-sky-300 bg-sky-500/10",
  low: "border-amber-500/40 text-amber-300 bg-amber-500/10",
};

export default function AskPage() {
  const [, navigate] = useLocation();
  const initialQ = useMemo(() => {
    if (typeof window === "undefined") return "";
    const sp = new URLSearchParams(window.location.search);
    return (sp.get("q") ?? "").trim();
  }, []);
  const [input, setInput] = useState(initialQ);
  const [activeQuestion, setActiveQuestion] = useState(initialQ);

  const askMutation = useMutation<AskResponse, Error, string>({
    mutationFn: async (question: string) => {
      const res = await apiRequest("POST", "/api/ask", { question });
      return (await res.json()) as AskResponse;
    },
  });

  useEffect(() => {
    if (initialQ) {
      askMutation.mutate(initialQ);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQ]);

  const submit = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setActiveQuestion(trimmed);
    const url = new URL(window.location.href);
    url.searchParams.set("q", trimmed);
    window.history.replaceState({}, "", url.toString());
    askMutation.mutate(trimmed);
  };

  const data = askMutation.data;
  const isLoading = askMutation.isPending;
  const error = askMutation.error;

  return (
    <div className="flex-1 p-4 md:p-6 max-w-4xl mx-auto w-full space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/home")} data-testid="button-ask-back">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 text-primary" />
          <span>Ask VCP Trader AI</span>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="flex items-center gap-2"
        data-testid="form-ask"
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything: 'Why is NVDA moving?', 'Best income ideas under $200 risk?'"
            className="pl-9 h-11"
            data-testid="input-ask"
            autoFocus
          />
        </div>
        <Button type="submit" disabled={isLoading || !input.trim()} className="h-11 gap-1.5" data-testid="button-ask-submit">
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          <span className="hidden sm:inline">Ask</span>
        </Button>
      </form>

      {!activeQuestion && !isLoading && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Type a question above to get an AI-generated answer with live news sentiment context.
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <Card data-testid="card-ask-loading">
          <CardHeader>
            <Skeleton className="h-5 w-1/2" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-9/12" />
            <div className="text-xs text-muted-foreground pt-2">Reading the question, pulling sentiment context, drafting an answer…</div>
          </CardContent>
        </Card>
      )}

      {error && !isLoading && (
        <Card className="border-rose-500/40 bg-rose-500/5" data-testid="card-ask-error">
          <CardContent className="p-4 flex items-start gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-rose-400 mt-0.5" />
            <div>
              <div className="font-medium text-rose-200">Couldn't generate an answer.</div>
              <div className="text-muted-foreground mt-1">{error.message || "Please try rephrasing your question."}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {data && !isLoading && (
        <>
          <Card data-testid="card-ask-answer">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <CardTitle className="text-lg leading-snug" data-testid="text-ask-headline">
                  {data.headline}
                </CardTitle>
                <Badge variant="outline" className={CONFIDENCE_TONE[data.confidence]} data-testid="badge-ask-confidence">
                  {data.confidence} confidence
                </Badge>
              </div>
              <div className="flex items-center gap-2 flex-wrap pt-1">
                <Badge variant="outline" className="text-[10px]" data-testid="badge-ask-source">
                  {data.source === "openai" ? "AI: gpt-4o-mini" : "AI: rule-based fallback"}
                </Badge>
                {data.tickers.map((t) => (
                  <Badge key={t} variant="secondary" className="text-[10px]" data-testid={`badge-ask-ticker-${t}`}>
                    {t}
                  </Badge>
                ))}
                {!data.brokerConnected && (
                  <Badge variant="outline" className="text-[10px] text-amber-300 border-amber-500/40 bg-amber-500/10">
                    No broker connected
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-relaxed whitespace-pre-line" data-testid="text-ask-answer">
                {data.answer}
              </p>

              {data.keyPoints.length > 0 && (
                <div className="space-y-1.5" data-testid="list-ask-keypoints">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Key points</div>
                  <ul className="space-y-1">
                    {data.keyPoints.map((kp, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm" data-testid={`text-ask-keypoint-${i}`}>
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
                        <span>{kp}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {data.riskNote && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs flex items-start gap-2" data-testid="text-ask-risk">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                  <div className="text-amber-100/90">{data.riskNote}</div>
                </div>
              )}
            </CardContent>
          </Card>

          {data.suggestions.length > 0 && (
            <Card data-testid="card-ask-suggestions">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Next steps</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {data.suggestions.map((s, i) => (
                  <Link key={i} href={s.href}>
                    <Button variant="outline" size="sm" className="gap-1" data-testid={`button-ask-suggestion-${i}`}>
                      {s.label}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}

          <p className="text-[11px] text-muted-foreground" data-testid="text-ask-disclaimer">
            {data.disclaimer}
          </p>
        </>
      )}

      <ComplianceFooter />
    </div>
  );
}
