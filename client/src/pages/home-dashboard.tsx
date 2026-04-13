import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  Link2,
  Layers,
  BookOpen,
  Zap,
  ArrowRight,
  CheckCircle2,
  LineChart,
  Sparkles,
  History,
} from "lucide-react";

interface SetupHistoryItem {
  id: string;
  symbol: string;
  strategyName: string;
  modelScore: number | null;
  createdAt: string;
}

export default function HomeDashboard() {
  const { isConnected, providerName } = useBrokerStatus();
  const { data: recentSetups } = useQuery<SetupHistoryItem[]>({
    queryKey: ["/api/agent/setups"],
  });

  const steps = [
    {
      number: 1,
      title: "Connect Your Broker",
      description: "Link your brokerage account for live market data and order execution",
      icon: Link2,
      href: "/broker-connections",
      done: isConnected,
      cta: isConnected ? "Connected" : "Connect Broker",
    },
    {
      number: 2,
      title: "Choose a Strategy",
      description: "Pick from built-in strategies or upload your own custom strategy",
      icon: Layers,
      href: "/strategies",
      done: false,
      cta: "Browse Strategies",
    },
    {
      number: 3,
      title: "Ask the Agent",
      description: "Describe a setup in plain language and let the AI generate a structured analysis",
      icon: Bot,
      href: "/agent",
      done: false,
      cta: "Open Agent",
    },
    {
      number: 4,
      title: "Review Setup",
      description: "Examine entry, stop, targets, reward/risk, and strategy reasoning",
      icon: LineChart,
      href: "/trade-setups",
      done: false,
      cta: "View Setups",
    },
    {
      number: 5,
      title: "Execute via InstaTrade™",
      description: "Send the setup to InstaTrade™ for streamlined order placement",
      icon: Zap,
      href: "/agent",
      done: false,
      cta: "Get Started",
    },
  ];

  return (
    <div className="flex-1 p-4 md:p-6 space-y-8 max-w-5xl mx-auto">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold" data-testid="text-page-title">
          Welcome to Strategy Agent
        </h1>
        <p className="text-muted-foreground" data-testid="text-page-subtitle">
          AI-powered strategy analysis and setup generation
        </p>
      </div>

      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent" data-testid="card-quick-start">
        <CardContent className="py-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-primary/15 border border-primary/20 flex items-center justify-center">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="font-semibold text-lg">Generate Your First Setup</h2>
                <p className="text-sm text-muted-foreground">
                  Try: "Give me a 15-minute ORB setup on TSLA"
                </p>
              </div>
            </div>
            <Link href="/agent">
              <Button size="lg" data-testid="button-go-to-agent">
                <Bot className="h-4 w-4 mr-2" />
                Open Agent
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">How It Works</h2>
        <div className="grid gap-3">
          {steps.map((step) => (
            <Card
              key={step.number}
              className={`bg-card/80 transition-colors ${step.done ? "border-green-500/20" : "hover:border-primary/30"}`}
              data-testid={`card-step-${step.number}`}
            >
              <CardContent className="py-4">
                <div className="flex items-center gap-4">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                    step.done
                      ? "bg-green-500/15 border border-green-500/30"
                      : "bg-accent/50 border border-border/40"
                  }`}>
                    {step.done ? (
                      <CheckCircle2 className="h-5 w-5 text-green-400" />
                    ) : (
                      <step.icon className="h-5 w-5 text-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground">Step {step.number}</span>
                      {step.done && <span className="text-[10px] text-green-400">Complete</span>}
                    </div>
                    <p className="text-sm font-medium">{step.title}</p>
                    <p className="text-xs text-muted-foreground">{step.description}</p>
                  </div>
                  <Link href={step.href}>
                    <Button variant={step.done ? "ghost" : "outline"} size="sm" data-testid={`button-step-${step.number}`}>
                      {step.cta}
                      <ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {recentSetups && recentSetups.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <History className="h-5 w-5 text-muted-foreground" />
              Recent Setups
            </h2>
            <Link href="/trade-setups">
              <Button variant="ghost" size="sm" data-testid="button-view-all-setups">
                View All <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {recentSetups.slice(0, 3).map((setup) => (
              <Card key={setup.id} className="bg-card/80" data-testid={`card-recent-${setup.id}`}>
                <CardContent className="py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-primary">{setup.symbol}</span>
                    <span className="text-xs text-muted-foreground">{setup.strategyName}</span>
                  </div>
                  {setup.modelScore !== null && (
                    <p className="text-xs text-muted-foreground mt-1">Score: {setup.modelScore}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {new Date(setup.createdAt).toLocaleString()}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/60 text-center pb-4" data-testid="text-disclaimer">
        This application provides software-generated strategy analysis and trade setup tools for informational and educational purposes only.
        It does not provide investment advice, trade recommendations, or guarantees. You are solely responsible for your trading decisions.
      </p>
    </div>
  );
}
