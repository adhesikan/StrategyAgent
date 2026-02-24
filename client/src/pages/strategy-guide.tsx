import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { 
  TrendingUp, Target, Activity, Zap, Clock, BarChart3, 
  Layers, ArrowUpRight, ArrowDownRight, AlertTriangle,
  CheckCircle2, Info, BookOpen, HelpCircle, Search,
  DollarSign, Shield, Repeat, CircleDot
} from "lucide-react";
import { STRATEGY_CONFIGS } from "@shared/strategies";

const STRATEGY_CATEGORIES = {
  momentum: {
    name: "Momentum Engines",
    description: "Strategies that capitalize on strong directional moves with volume confirmation",
    icon: Zap,
    color: "text-orange-500",
  },
  trend: {
    name: "Trend Engines", 
    description: "Strategies focused on established trends and continuation patterns",
    icon: TrendingUp,
    color: "text-blue-500",
  },
  volatility: {
    name: "Volatility Engines",
    description: "Strategies that identify volatility contraction and expansion setups",
    icon: Activity,
    color: "text-purple-500",
  },
  intraday: {
    name: "Intraday Engines",
    description: "Time-sensitive strategies for active day trading",
    icon: Clock,
    color: "text-green-500",
  },
};

const STRATEGY_DETAILS: Record<string, {
  category: keyof typeof STRATEGY_CATEGORIES;
  overview: string;
  characteristics: string[];
  entrySignals: string[];
  riskManagement: string[];
  bestConditions: string;
  timeframe: string;
}> = {
  VCP: {
    category: "volatility",
    overview: "The Volatility Contraction Pattern (VCP) identifies stocks with progressively tighter price ranges, suggesting accumulation before a potential breakout.",
    characteristics: [
      "Multiple contractions with each range smaller than the previous",
      "Volume tends to decrease during consolidation",
      "Price stays near the upper range of the base",
      "Pattern typically forms over 3-6 weeks",
    ],
    entrySignals: [
      "Price breaks above the pivot/resistance with increased volume",
      "Volume should be at least 1.5x the average",
      "Price holds above the breakout level on the first pullback",
    ],
    riskManagement: [
      "Stop loss below the most recent contraction low",
      "Risk no more than 1-2% of portfolio per trade",
      "Consider scaling out at 1:1 and 2:1 reward targets",
    ],
    bestConditions: "Works best in trending markets with sector rotation",
    timeframe: "Swing trading (days to weeks)",
  },
  VCP_MULTIDAY: {
    category: "volatility",
    overview: "Extended VCP patterns that develop over longer timeframes, typically showing stronger institutional accumulation.",
    characteristics: [
      "Pattern develops over 4-12 weeks",
      "More defined contraction phases (usually 3-4)",
      "Often shows relative strength vs. market during formation",
      "Higher probability of sustained breakout moves",
    ],
    entrySignals: [
      "Decisive break above multi-week resistance",
      "Gap up with volume exceeding 2x average",
      "Follow-through day within 3 sessions of breakout",
    ],
    riskManagement: [
      "Wider stops due to longer-term pattern",
      "Position size accordingly for larger stop distance",
      "Target 20-50% moves based on base depth",
    ],
    bestConditions: "Bull markets with clear leadership groups",
    timeframe: "Position trading (weeks to months)",
  },
  CLASSIC_PULLBACK: {
    category: "trend",
    overview: "Identifies stocks in uptrends that have pulled back to key support levels, offering lower-risk entry points.",
    characteristics: [
      "Stock in established uptrend (above 20/50 EMA)",
      "Orderly pullback on declining volume",
      "Holds at moving average or prior resistance-turned-support",
      "RSI pulling back from overbought to neutral",
    ],
    entrySignals: [
      "Bounce off support with bullish candle pattern",
      "Volume expansion on the bounce day",
      "Reclaim of short-term moving average (9 EMA)",
    ],
    riskManagement: [
      "Stop below the swing low or support level",
      "Target previous highs or measured move",
      "Trail stop using 9 or 21 EMA",
    ],
    bestConditions: "Trending markets, avoid during high volatility",
    timeframe: "Swing trading (days to weeks)",
  },
  VWAP_RECLAIM: {
    category: "intraday",
    overview: "Identifies stocks that have dipped below VWAP and are reclaiming it, signaling potential continuation of the primary trend.",
    characteristics: [
      "Stock trading below VWAP after opening strong",
      "Consolidation near VWAP level",
      "Relative strength vs. sector during pullback",
      "Bid/ask showing accumulation at VWAP",
    ],
    entrySignals: [
      "Price reclaims VWAP with volume surge",
      "Higher low pattern forming near VWAP",
      "Tape shows aggressive buying at ask",
    ],
    riskManagement: [
      "Stop below the low of the consolidation",
      "Quick partial profits at recent highs",
      "Trail remainder using VWAP as guide",
    ],
    bestConditions: "Active trading hours (10am-12pm, 2pm-3:30pm)",
    timeframe: "Intraday (minutes to hours)",
  },
  ORB5: {
    category: "intraday",
    overview: "5-minute Opening Range Breakout captures early momentum by trading breaks of the first 5 minutes high/low.",
    characteristics: [
      "Clear directional bias established quickly",
      "Works best with gap-up or gap-down opens",
      "Higher win rate on high relative volume days",
      "Quick resolution - usually know within 30 mins",
    ],
    entrySignals: [
      "Break above 5-min high with volume",
      "Pre-market volume above average",
      "Sector showing relative strength",
    ],
    riskManagement: [
      "Stop at opposite side of opening range",
      "Target 1:1 then trail aggressively",
      "Exit if no follow-through by 10am",
    ],
    bestConditions: "High-catalyst days, earnings, news events",
    timeframe: "Intraday (5-60 minutes)",
  },
  ORB15: {
    category: "intraday",
    overview: "15-minute Opening Range Breakout allows more price discovery before entry, reducing false breakouts.",
    characteristics: [
      "More reliable range than 5-min ORB",
      "Better for choppy open conditions",
      "Allows time to assess market direction",
      "Often aligns with institutional order flow",
    ],
    entrySignals: [
      "Decisive break of 15-min range with conviction",
      "Volume pickup on breakout candle",
      "Alignment with overall market direction",
    ],
    riskManagement: [
      "Stop at midpoint or opposite side of range",
      "Scale out at prior day levels",
      "Don't hold past midday if not working",
    ],
    bestConditions: "Trending market days, avoid Fed/CPI days early",
    timeframe: "Intraday (15 mins - 2 hours)",
  },
  HIGH_RVOL: {
    category: "momentum",
    overview: "Targets stocks with unusually high relative volume, indicating significant interest and potential for large moves.",
    characteristics: [
      "RVOL 2x or higher vs 20-day average",
      "Often catalyst-driven (news, earnings)",
      "Wide intraday ranges",
      "Active options flow",
    ],
    entrySignals: [
      "Consolidation after initial move",
      "Higher lows forming with volume",
      "Break of intraday resistance with continuation",
    ],
    riskManagement: [
      "Tight stops due to increased volatility",
      "Smaller position sizes",
      "Quick partial profits mandatory",
    ],
    bestConditions: "Any market condition, news-driven",
    timeframe: "Intraday to swing",
  },
  GAP_AND_GO: {
    category: "momentum",
    overview: "Capitalizes on stocks gapping up significantly at open and continuing in the gap direction.",
    characteristics: [
      "Gap of 3%+ from previous close",
      "High pre-market volume and interest",
      "Clear catalyst (earnings, news, upgrade)",
      "Sector support for the move",
    ],
    entrySignals: [
      "First pullback after gap holds higher",
      "Break of pre-market or opening range high",
      "Volume confirming buyer conviction",
    ],
    riskManagement: [
      "Stop below the pullback low",
      "Avoid chasing extended moves",
      "Scale out as gap fills or extends",
    ],
    bestConditions: "Bull markets, strong sector rotation",
    timeframe: "Intraday (first 1-2 hours)",
  },
  TREND_CONTINUATION: {
    category: "trend",
    overview: "Identifies established trends with healthy consolidation patterns suggesting continuation rather than reversal.",
    characteristics: [
      "Clear trend with higher highs/higher lows",
      "Moving averages in proper alignment",
      "Tight consolidation after strong move",
      "Relative strength vs. sector and market",
    ],
    entrySignals: [
      "Break from consolidation in trend direction",
      "Volume expansion on breakout",
      "Follow-through within 1-2 days",
    ],
    riskManagement: [
      "Stop below consolidation or 21 EMA",
      "Trail using higher swing lows",
      "Add to position on successful retests",
    ],
    bestConditions: "Trending bull markets",
    timeframe: "Swing to position trading",
  },
  VOLATILITY_SQUEEZE: {
    category: "volatility",
    overview: "Identifies stocks with extremely tight Bollinger Bands suggesting a volatility expansion is imminent.",
    characteristics: [
      "Bollinger Band width at multi-week lows",
      "Price coiling in tight range",
      "Decreasing volume during squeeze",
      "Often coincides with VCP formations",
    ],
    entrySignals: [
      "Expansion breakout from squeeze",
      "Momentum indicator confirming direction",
      "Volume surge on breakout candle",
    ],
    riskManagement: [
      "Stop at opposite side of squeeze range",
      "Expect fast moves - take quick profits",
      "Watch for failed breakouts to reverse",
    ],
    bestConditions: "Before catalysts or after extended consolidation",
    timeframe: "Swing trading",
  },
};

const STAGE_EXPLANATIONS = [
  {
    stage: "FORMING",
    color: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
    icon: Clock,
    description: "Pattern is in early development. Price is consolidating and the setup is not yet mature.",
    action: "Add to watchlist and monitor for progression to READY stage.",
  },
  {
    stage: "READY",
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    icon: Target,
    description: "Pattern is mature and approaching the breakout zone. The setup meets strategy criteria.",
    action: "Set price alerts, calculate position size, and prepare your entry plan.",
  },
  {
    stage: "BREAKOUT",
    color: "bg-green-500/10 text-green-600 dark:text-green-400",
    icon: ArrowUpRight,
    description: "Price is breaking above resistance with volume confirmation. Breakout confirmed with follow-through.",
    action: "Evaluate entry based on your rules. Check volume and price action quality. If already in position, manage the trade.",
  },
];

function StrategyCard({ strategyId }: { strategyId: string }) {
  const config = STRATEGY_CONFIGS.find(s => s.id === strategyId);
  const details = STRATEGY_DETAILS[strategyId];
  const category = details ? STRATEGY_CATEGORIES[details.category] : null;

  if (!config || !details) return null;

  return (
    <Card data-testid={`card-strategy-${strategyId}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-lg">{config.displayName}</CardTitle>
            <CardDescription className="mt-1">{config.shortDescription}</CardDescription>
          </div>
          {category && (
            <Badge variant="outline" className="shrink-0">
              <category.icon className={`h-3 w-3 mr-1 ${category.color}`} />
              {category.name.replace(" Engines", "")}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-sm text-muted-foreground">{details.overview}</p>
        </div>

        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="characteristics">
            <AccordionTrigger className="text-sm">Pattern Characteristics</AccordionTrigger>
            <AccordionContent>
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                {details.characteristics.map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                    {item}
                  </li>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="entry">
            <AccordionTrigger className="text-sm">Entry Signals</AccordionTrigger>
            <AccordionContent>
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                {details.entrySignals.map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <ArrowUpRight className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                    {item}
                  </li>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="risk">
            <AccordionTrigger className="text-sm">Risk Management</AccordionTrigger>
            <AccordionContent>
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                {details.riskManagement.map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    {item}
                  </li>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="grid grid-cols-2 gap-3 pt-2 border-t text-sm">
          <div>
            <p className="text-muted-foreground text-xs mb-0.5">Best Conditions</p>
            <p className="font-medium">{details.bestConditions}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs mb-0.5">Timeframe</p>
            <p className="font-medium">{details.timeframe}</p>
          </div>
        </div>

        <Button variant="outline" size="sm" className="w-full mt-2" asChild>
          <Link href={`/discover?tab=stocks`} data-testid={`button-run-scanner-${strategyId.toLowerCase()}`}>
            <Search className="h-4 w-4 mr-1" />
            Run Scanner
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function StrategyGuide() {
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const filteredCategories = categoryFilter === "all"
    ? Object.entries(STRATEGY_CATEGORIES)
    : Object.entries(STRATEGY_CATEGORIES).filter(([key]) => key === categoryFilter);

  return (
    <div className="p-4 lg:p-6 space-y-6" data-testid="strategy-guide-page">
      <div>
        <h1 className="text-xl lg:text-2xl font-semibold tracking-tight flex items-center gap-2">
          <HelpCircle className="h-6 w-6" />
          Help & Guide
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Learn about strategies, pattern stages, and how to use the scanner
        </p>
      </div>

      <Tabs defaultValue="strategies" className="w-full">
        <TabsList className="grid w-full grid-cols-4 mb-6">
          <TabsTrigger value="strategies" data-testid="tab-strategies">Strategies</TabsTrigger>
          <TabsTrigger value="options" data-testid="tab-options">Options</TabsTrigger>
          <TabsTrigger value="stages" data-testid="tab-stages">Pattern Stages</TabsTrigger>
          <TabsTrigger value="howto" data-testid="tab-howto">How to Use</TabsTrigger>
        </TabsList>

        <TabsContent value="strategies" className="space-y-6">
          <div className="flex flex-wrap gap-2" data-testid="filter-categories">
            <Badge
              variant={categoryFilter === "all" ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setCategoryFilter("all")}
              data-testid="filter-all"
            >
              All
            </Badge>
            {Object.entries(STRATEGY_CATEGORIES).map(([key, cat]) => (
              <Badge
                key={key}
                variant={categoryFilter === key ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setCategoryFilter(key)}
                data-testid={`filter-${key}`}
              >
                <cat.icon className={`h-3 w-3 mr-1 ${cat.color}`} />
                {cat.name.replace(" Engines", "")}
              </Badge>
            ))}
          </div>

          {filteredCategories.map(([categoryKey, category]) => (
            <div key={categoryKey} className="space-y-4">
              <div className="flex items-center gap-2">
                <category.icon className={`h-5 w-5 ${category.color}`} />
                <h2 className="text-lg font-semibold">{category.name}</h2>
              </div>
              <p className="text-sm text-muted-foreground -mt-2">{category.description}</p>
              <div className="grid gap-4 md:grid-cols-2">
                {Object.entries(STRATEGY_DETAILS)
                  .filter(([_, details]) => details.category === categoryKey)
                  .map(([strategyId]) => (
                    <StrategyCard key={strategyId} strategyId={strategyId} />
                  ))}
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="options" className="space-y-6" data-testid="options-strategies-content">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-chart-2" />
              Options Scanning Strategies
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              The Options Scanner finds trade ideas across hundreds of stocks in seconds. Pick a strategy that matches your outlook and risk tolerance.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Card data-testid="card-options-long-options">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-lg">Long Options</CardTitle>
                  <Badge variant="outline" className="bg-green-500/10 text-green-600 dark:text-green-400 shrink-0">Beginner Friendly</Badge>
                </div>
                <CardDescription>Buy calls when you think a stock will go up, or puts when you think it will go down. Simple and straightforward.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-3 rounded-md bg-muted/50 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Info className="h-4 w-4 shrink-0" />
                    <span className="font-medium text-foreground">Tip</span>
                  </div>
                  Great starting point. You buy an option and your maximum loss is what you paid for it.
                </div>

                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="how-it-works">
                    <AccordionTrigger className="text-sm" data-testid="accordion-long-options-how-it-works">How It Works</AccordionTrigger>
                    <AccordionContent>
                      <p className="text-sm text-muted-foreground">
                        Buys a call (bullish) or put (bearish) option on a stock. You profit when the stock moves in your predicted direction beyond the breakeven price before expiration. Your maximum loss is limited to the premium paid.
                      </p>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="variants">
                    <AccordionTrigger className="text-sm" data-testid="accordion-long-options-variants">Strategy Variants</AccordionTrigger>
                    <AccordionContent>
                      <ul className="space-y-2 text-sm text-muted-foreground">
                        <li className="flex items-start gap-2">
                          <ArrowUpRight className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                          <span><strong>Long Call</strong> - Bullish bet. Profits when the stock rises above strike + premium paid.</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <ArrowDownRight className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                          <span><strong>Long Put</strong> - Bearish bet. Profits when the stock falls below strike - premium paid.</span>
                        </li>
                      </ul>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="scanner-criteria">
                    <AccordionTrigger className="text-sm" data-testid="accordion-long-options-scanner-criteria">How the Scanner Picks</AccordionTrigger>
                    <AccordionContent>
                      <ul className="space-y-1.5 text-sm text-muted-foreground">
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                          Ranks by implied volatility vs. historical range to find undervalued options
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                          Filters for your preferred delta range to balance cost vs. probability
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                          Requires minimum premium % relative to stock price for adequate reward
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                          Selects strikes slightly out-of-the-money for optimal risk/reward
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                          Prioritizes contracts with strong open interest and volume for liquidity
                        </li>
                      </ul>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="risk">
                    <AccordionTrigger className="text-sm" data-testid="accordion-long-options-risk">Risk Profile</AccordionTrigger>
                    <AccordionContent>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-muted-foreground text-xs mb-0.5">Max Loss</p>
                          <p className="font-medium">Premium paid (defined)</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs mb-0.5">Max Profit</p>
                          <p className="font-medium">Unlimited (calls) / Strike - Premium (puts)</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs mb-0.5">Typical DTE</p>
                          <p className="font-medium">14-45 days</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs mb-0.5">Delta Range</p>
                          <p className="font-medium">0.15 - 0.35</p>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>

                <Button variant="outline" size="sm" className="w-full mt-2" asChild>
                  <Link href="/discover?tab=options" data-testid="button-run-options-long">
                    <Search className="h-4 w-4 mr-1" />
                    Run Options Scanner
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <Card data-testid="card-options-wheel">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-lg">Wheel Strategy</CardTitle>
                  <Badge variant="outline" className="bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0">Intermediate</Badge>
                </div>
                <CardDescription>Get paid to wait for stocks you want to buy at a lower price. If assigned, sell calls to earn more income.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-3 rounded-md bg-muted/50 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Info className="h-4 w-4 shrink-0" />
                    <span className="font-medium text-foreground">Tip</span>
                  </div>
                  Best for stocks you'd want to own anyway. You earn income while waiting.
                </div>

                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="how-it-works">
                    <AccordionTrigger className="text-sm" data-testid="accordion-wheel-how-it-works">How It Works</AccordionTrigger>
                    <AccordionContent>
                      <p className="text-sm text-muted-foreground">
                        A two-phase income strategy. Phase 1: Sell cash-secured puts on stocks you want to own at a lower price, collecting premium. If assigned, Phase 2: Sell covered calls on the shares you now own, collecting more premium. The cycle repeats, generating steady income.
                      </p>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="variants">
                    <AccordionTrigger className="text-sm" data-testid="accordion-wheel-variants">Strategy Variants</AccordionTrigger>
                    <AccordionContent>
                      <ul className="space-y-2 text-sm text-muted-foreground">
                        <li className="flex items-start gap-2">
                          <Repeat className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                          <span><strong>Cash-Secured Put</strong> - Sell puts to get paid while waiting to buy. Keep 100% of premium if stock stays above strike.</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <Repeat className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                          <span><strong>Covered Call</strong> - Own the stock and sell calls above your cost basis. Earn income while holding.</span>
                        </li>
                      </ul>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="scanner-criteria">
                    <AccordionTrigger className="text-sm" data-testid="accordion-wheel-scanner-criteria">How the Scanner Picks</AccordionTrigger>
                    <AccordionContent>
                      <ul className="space-y-1.5 text-sm text-muted-foreground">
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                          Selects high-quality stocks suitable for long-term ownership
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                          Cash-Secured Put: finds puts with premium income above your minimum threshold
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                          Covered Call: finds calls above the stock price to earn income while holding
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                          Targets delta range that balances premium income with assignment probability
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                          Scores higher when annualized return from premium is attractive vs. capital required
                        </li>
                      </ul>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="risk">
                    <AccordionTrigger className="text-sm" data-testid="accordion-wheel-risk">Risk Profile</AccordionTrigger>
                    <AccordionContent>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-muted-foreground text-xs mb-0.5">Max Loss</p>
                          <p className="font-medium">Stock goes to $0 (put assignment risk)</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs mb-0.5">Max Profit</p>
                          <p className="font-medium">Premium collected per cycle</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs mb-0.5">Typical DTE</p>
                          <p className="font-medium">14-45 days</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs mb-0.5">Capital Needed</p>
                          <p className="font-medium">100 shares worth (cash-secured)</p>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>

                <Button variant="outline" size="sm" className="w-full mt-2" asChild>
                  <Link href="/discover?tab=options" data-testid="button-run-options-wheel">
                    <Search className="h-4 w-4 mr-1" />
                    Run Options Scanner
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <Card data-testid="card-options-credit-spreads">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-lg">Credit Spreads</CardTitle>
                  <Badge variant="outline" className="bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0">Intermediate</Badge>
                </div>
                <CardDescription>Collect premium by selling spreads. You profit when the stock stays in your expected range.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-3 rounded-md bg-muted/50 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Info className="h-4 w-4 shrink-0" />
                    <span className="font-medium text-foreground">Tip</span>
                  </div>
                  Lower risk than selling naked options. Your max loss and max gain are both defined upfront.
                </div>

                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="how-it-works">
                    <AccordionTrigger className="text-sm" data-testid="accordion-credit-spreads-how-it-works">How It Works</AccordionTrigger>
                    <AccordionContent>
                      <p className="text-sm text-muted-foreground">
                        Sells a spread by simultaneously selling one option and buying another at a different strike. You collect a net credit upfront and keep it if the stock stays in your expected range at expiration. Both max profit and max loss are defined at entry.
                      </p>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="variants">
                    <AccordionTrigger className="text-sm" data-testid="accordion-credit-spreads-variants">Strategy Variants</AccordionTrigger>
                    <AccordionContent>
                      <ul className="space-y-2 text-sm text-muted-foreground">
                        <li className="flex items-start gap-2">
                          <ArrowUpRight className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                          <span><strong>Bull Put Spread</strong> - Bullish. Sell a higher put, buy a lower put. You profit when the stock stays above the short strike.</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <ArrowDownRight className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                          <span><strong>Bear Call Spread</strong> - Bearish. Sell a lower call, buy a higher call. You profit when the stock stays below the short strike.</span>
                        </li>
                      </ul>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="scanner-criteria">
                    <AccordionTrigger className="text-sm" data-testid="accordion-credit-spreads-scanner-criteria">How the Scanner Picks</AccordionTrigger>
                    <AccordionContent>
                      <ul className="space-y-1.5 text-sm text-muted-foreground">
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                          Finds spread widths that offer favorable risk/reward ratios
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                          Bull Put Spread: places short strike below current price in a support zone
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                          Bear Call Spread: places short strike above current price near resistance
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                          Ranks by probability of profit (PoP) combined with premium collected
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                          Requires both legs to have adequate liquidity for clean fills
                        </li>
                      </ul>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="risk">
                    <AccordionTrigger className="text-sm" data-testid="accordion-credit-spreads-risk">Risk Profile</AccordionTrigger>
                    <AccordionContent>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-muted-foreground text-xs mb-0.5">Max Loss</p>
                          <p className="font-medium">Spread width - credit received</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs mb-0.5">Max Profit</p>
                          <p className="font-medium">Credit received at entry</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs mb-0.5">Typical DTE</p>
                          <p className="font-medium">14-45 days</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs mb-0.5">Capital Needed</p>
                          <p className="font-medium">Spread width x 100 (collateral)</p>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>

                <Button variant="outline" size="sm" className="w-full mt-2" asChild>
                  <Link href="/discover?tab=options" data-testid="button-run-options-spreads">
                    <Search className="h-4 w-4 mr-1" />
                    Run Options Scanner
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Scanner Settings</CardTitle>
              <CardDescription>The options scanner uses configurable parameters to filter candidates</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <p className="font-medium">Days to Expiration (DTE)</p>
                </div>
                <p className="text-sm text-muted-foreground">Default range is 14-45 days. Shorter DTE means faster time decay (good for sellers), longer DTE gives more time for the trade to work (good for buyers).</p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <p className="font-medium">Delta Range</p>
                </div>
                <p className="text-sm text-muted-foreground">Default is 0.15-0.35. Lower delta means cheaper options with lower probability. Higher delta means more expensive options that are more likely to profit.</p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <p className="font-medium">Minimum Premium %</p>
                </div>
                <p className="text-sm text-muted-foreground">The minimum option price as a percentage of the stock price. Default is 0.5%. Filters out options that are too cheap to be worthwhile.</p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <p className="font-medium">Risk Settings</p>
                </div>
                <p className="text-sm text-muted-foreground">Choose Aggressive, Balanced, or Conservative presets that adjust deployment %, risk per trade, and safety controls to match your risk tolerance.</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Comparing the Three Strategies</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Feature</th>
                      <th className="text-left py-2 px-4 font-medium">Long Options</th>
                      <th className="text-left py-2 px-4 font-medium">Wheel</th>
                      <th className="text-left py-2 pl-4 font-medium">Credit Spreads</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b">
                      <td className="py-2 pr-4 text-muted-foreground">Difficulty</td>
                      <td className="py-2 px-4">Beginner</td>
                      <td className="py-2 px-4">Intermediate</td>
                      <td className="py-2 pl-4">Intermediate</td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 pr-4 text-muted-foreground">Direction</td>
                      <td className="py-2 px-4">Bullish or Bearish</td>
                      <td className="py-2 px-4">Neutral to Bullish</td>
                      <td className="py-2 pl-4">Neutral (range-bound)</td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 pr-4 text-muted-foreground">Risk Type</td>
                      <td className="py-2 px-4">Defined (premium paid)</td>
                      <td className="py-2 px-4">Significant (stock ownership)</td>
                      <td className="py-2 pl-4">Defined (spread width)</td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 pr-4 text-muted-foreground">Income Style</td>
                      <td className="py-2 px-4">Capital gains</td>
                      <td className="py-2 px-4">Premium income</td>
                      <td className="py-2 pl-4">Premium income</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 text-muted-foreground">Capital Needed</td>
                      <td className="py-2 px-4">Low (just premium)</td>
                      <td className="py-2 px-4">High (100 shares worth)</td>
                      <td className="py-2 pl-4">Moderate (collateral)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stages" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Understanding Pattern Stages</CardTitle>
              <CardDescription>
                Each scan result is assigned a stage based on where the pattern is in its development cycle
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {STAGE_EXPLANATIONS.map((stage) => (
                <div key={stage.stage} className="flex items-start gap-4 p-4 rounded-lg border">
                  <Badge variant="outline" className={`${stage.color} shrink-0`}>
                    {stage.stage}
                  </Badge>
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <stage.icon className="h-4 w-4 text-muted-foreground" />
                      <p className="font-medium">{stage.description}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      <strong>Action:</strong> {stage.action}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Stage Progression</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                {STAGE_EXPLANATIONS.map((stage, index) => (
                  <div key={stage.stage} className="flex items-center gap-2">
                    <Badge variant="outline" className={stage.color}>
                      {stage.stage}
                    </Badge>
                    {index < STAGE_EXPLANATIONS.length - 1 && (
                      <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                ))}
              </div>
              <p className="text-sm text-muted-foreground mt-4">
                Patterns progress through these stages as they develop. Not all patterns will reach the BREAKOUT stage - many will fail and return to FORMING or break down entirely.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="howto" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Quick Start</CardTitle>
              <CardDescription>Get started with the Scanner in 4 simple steps</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-4">
                <li className="flex items-start gap-3">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">1</div>
                  <div>
                    <p className="font-medium">Choose Your Mode</p>
                    <p className="text-sm text-muted-foreground">Single Strategy scans for one pattern type. Fusion Engine finds stocks matching multiple patterns for higher conviction.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">2</div>
                  <div>
                    <p className="font-medium">Select What to Scan</p>
                    <p className="text-sm text-muted-foreground">Choose a watchlist for focused scanning, enter a specific symbol, or scan an entire market index (S&P 500, Nasdaq 100, etc.).</p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">3</div>
                  <div>
                    <p className="font-medium">Pick a Filter Preset</p>
                    <p className="text-sm text-muted-foreground">Balanced works for most traders. Conservative filters for safer, higher-quality setups. Aggressive shows more opportunities with higher risk.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">4</div>
                  <div>
                    <p className="font-medium">Run and Review</p>
                    <p className="text-sm text-muted-foreground">Click the scan button and review results. Active Opportunities (BREAKOUT) appear at the top. Click any row to see the chart.</p>
                  </div>
                </li>
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Key Features</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-chart-2" />
                  <p className="font-medium">Resistance Levels</p>
                </div>
                <p className="text-sm text-muted-foreground">Auto-calculated breakout levels based on pattern analysis. Green color indicates the target price.</p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <ArrowDownRight className="h-4 w-4 text-destructive" />
                  <p className="font-medium">Stop Loss Levels</p>
                </div>
                <p className="text-sm text-muted-foreground">Suggested stop prices to manage risk. Red color indicates the protective stop level.</p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  <p className="font-medium">Pattern Score</p>
                </div>
                <p className="text-sm text-muted-foreground">Quality rating from 0-100 based on volume, price action, and pattern structure.</p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <p className="font-medium">Relative Volume (RVOL)</p>
                </div>
                <p className="text-sm text-muted-foreground">Current volume vs 20-day average. Values above 1.5x suggest strong interest.</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tips for Best Results</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                  <span>Connect a broker for real-time market data instead of delayed quotes</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                  <span>Save your preferred settings as defaults for faster scanning</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                  <span>Focus on READY and BREAKOUT stages for actionable setups</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                  <span>Use the Fusion Engine to find high-conviction multi-pattern matches</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-chart-2 shrink-0 mt-0.5" />
                  <span>Set up alerts to get notified when patterns reach BREAKOUT stage</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
