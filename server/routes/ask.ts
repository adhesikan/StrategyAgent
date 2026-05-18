import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { refreshSentimentForSymbols, isOpenAiConfigured } from "../services/news";
import { getMarketSnapshot, type MarketSnapshot } from "../services/market-data";
import {
  findBestTrades,
  findBestTradesForSymbol,
  type BestTradePick,
  type BestTradeForSymbolResult,
} from "../services/best-trade-finder";
import { parsePrompt } from "../agent/prompt-interpreter";
import { selectInstrument } from "../services/instrument-selector";
import { scoreSetup } from "../services/probability-engine";
import type { TradeSetup } from "../agent/strategy-engine";
import { buildLongCallPlan, buildLongPutPlan, type OptionPlan } from "../services/options-evaluator";

// Compact, human-readable trade ticket returned alongside the AI prose so
// users see real strikes/expiry/credit instead of a vague suggestion. Every
// number comes from the live snapshot price + the deterministic option-plan
// builders — we never invent strikes.
export interface AskTradeDetail {
  symbol: string;
  // Directional debit trades (long_call/long_put) are debits paid up front;
  // CSP/CC are credit-collecting income trades. The frontend branches on
  // strategy to render the right labels (Debit vs Credit, Breakeven box, etc).
  strategy: "cash_secured_put" | "covered_call" | "long_call" | "long_put";
  strategyLabel: string;
  bias: "bullish" | "bearish" | "neutral";
  // Whether the active signals on this symbol AGREE with the requested trade
  // direction. Set when the trade is built from a directional ask (long
  // call/put) so the UI can call out a contrary-bias warning.
  signalAlignment?: "aligned" | "contrary" | "neutral";
  signalAlignmentNote?: string;
  spot: number;
  strike: number;
  optionType: "put" | "call";
  expiry: string;
  dte: number;
  // For credit trades (CSP/CC) this is the credit collected per share.
  // For debit trades (long_call/long_put) this is the premium PAID per share.
  premiumPerShare: number;
  premiumPerContract: number;
  collateralPerContract: number; // CSP only: cash collateral required per contract
  upsideCapPerContract: number | null; // CC only: max proceeds at assignment = (strike + premium) * 100
  maxProfitPerContract: number;
  maxLossPerContract: number;
  breakeven: number;
  delta: number;
  reasons: string[];
  warnings: string[];
  dataMode: "live" | "simulated";
}

// Directional debit ticket — long call (bullish) or long put (bearish).
// Used when the user asks "find a long call on MU" so we return a concrete
// strike + expiry + debit instead of generic prose.
function buildDirectionalTradeDetail(
  symbol: string,
  livePrice: number | null,
  direction: "long_call" | "long_put",
): AskTradeDetail {
  const spot = livePrice && livePrice > 0 ? livePrice : 100;
  const dataMode: "live" | "simulated" = livePrice && livePrice > 0 ? "live" : "simulated";
  const bullish = direction === "long_call";

  const setup: TradeSetup = {
    id: `ask_${Date.now()}`,
    symbol,
    assetType: "option",
    strategyName: bullish ? "Long Call" : "Long Put",
    timeframe: "1D",
    setupType: "trade",
    bias: bullish ? "bullish" : "bearish",
    entry: spot,
    stop: bullish ? spot * 0.95 : spot * 1.05,
    targets: bullish ? [spot * 1.08, spot * 1.12] : [spot * 0.92, spot * 0.88],
    rewardRisk: null,
    modelScore: null,
    reasoning: [],
    invalidation: [],
    metrics: { currentPrice: spot },
    dataSource: dataMode === "live" ? "live broker quote" : "simulated price baseline",
    generatedAt: new Date().toISOString(),
  };

  const plan: OptionPlan = bullish ? buildLongCallPlan(setup) : buildLongPutPlan(setup);
  const leg = plan.legs[0];
  // Debit trades expose a positive netDebit — that's the premium the user pays.
  const debit = Math.abs(plan.netDebit);

  return {
    symbol,
    strategy: direction,
    strategyLabel: bullish ? "Long call" : "Long put",
    bias: setup.bias,
    spot: parseFloat(spot.toFixed(2)),
    strike: leg.strike,
    optionType: leg.type,
    expiry: plan.expiry,
    dte: plan.dte,
    premiumPerShare: parseFloat(debit.toFixed(2)),
    premiumPerContract: parseFloat((debit * 100).toFixed(2)),
    collateralPerContract: 0,
    upsideCapPerContract: null,
    maxProfitPerContract: parseFloat((plan.maxProfit * 100).toFixed(2)),
    maxLossPerContract: parseFloat((plan.maxLoss * 100).toFixed(2)),
    breakeven: plan.breakeven,
    delta: leg.delta,
    reasons: plan.reasons,
    warnings: plan.warnings,
    dataMode,
  };
}

// Detect directional debit-option asks ("long call on MU", "buy a put on TSLA",
// "call option on AAPL"). Returns the direction or null. Multi-leg strategies
// (spreads, verticals, iron condors, butterflies, strangles, straddles,
// collars, credit/debit-spread phrasings) are excluded so e.g. "buy a call
// spread on AAPL" does NOT get routed into a single-leg long call ticket.
const MULTI_LEG_HINT = /\b(spread|vertical|iron|condor|butterfly|strangle|straddle|collar|calendar|diagonal|credit\s+spread|debit\s+spread)\b/;
function detectDirectionalOption(lower: string): "long_call" | "long_put" | null {
  if (MULTI_LEG_HINT.test(lower)) return null;
  if (/\b(long\s+calls?|buy\s+(a\s+|the\s+|some\s+)?calls?|call\s+options?)\b/.test(lower)) return "long_call";
  if (/\b(long\s+puts?|buy\s+(a\s+|the\s+|some\s+)?puts?|put\s+options?)\b/.test(lower)) return "long_put";
  return null;
}

function buildIncomeTradeDetail(
  symbol: string,
  livePrice: number | null,
  incomeIntent: "wheel" | "cash_secured_put" | "covered_call",
): AskTradeDetail | null {
  // We need a real spot to build a meaningful plan. If we don't have a live
  // quote, fall back to a simulated price baseline so the preview still shows
  // realistic shape — clearly marked as simulated.
  const spot = livePrice && livePrice > 0 ? livePrice : 100;
  const dataMode: "live" | "simulated" = livePrice && livePrice > 0 ? "live" : "simulated";

  // Wheel + (default) put → CSP. Wheel + call-only would be CC (handled when
  // the prompt interpreter pinned to "covered_call").
  const wantedStrategy: "cash_secured_put" | "covered_call" =
    incomeIntent === "covered_call" ? "covered_call" : "cash_secured_put";

  // Minimal TradeSetup so the existing selector machinery works unchanged.
  const setup: TradeSetup = {
    id: `ask_${Date.now()}`,
    symbol,
    assetType: "option",
    strategyName: wantedStrategy === "cash_secured_put" ? "Cash-Secured Put (Wheel)" : "Covered Call (Wheel)",
    timeframe: "1D",
    setupType: "income",
    bias: "neutral",
    entry: spot,
    stop: spot * 0.95,
    targets: [spot * 1.02, spot * 1.05],
    rewardRisk: null,
    modelScore: null,
    reasoning: [],
    invalidation: [],
    metrics: { currentPrice: spot },
    dataSource: dataMode === "live" ? "live broker quote" : "simulated price baseline",
    generatedAt: new Date().toISOString(),
  };

  const probability = scoreSetup({ setup });
  const recommendation = selectInstrument({
    setup,
    probability,
    prefs: {},
    incomeIntent,
  });

  const plan: OptionPlan | undefined = recommendation.recommendedPlan;
  if (!plan || plan.legs.length === 0) return null;
  if (plan.strategyType !== "cash_secured_put" && plan.strategyType !== "covered_call") return null;

  const leg = plan.legs[0];
  // Credit trades expose the premium as a negative netDebit.
  const credit = Math.abs(plan.netDebit);
  // CSP: cash you must keep aside (strike × 100, minus the premium credited).
  // CC : the 100 shares are the collateral, not cash — we report 0 here and
  // surface upsideCapPerContract instead, which is the actually meaningful
  // ceiling for a covered call.
  const collateral = plan.strategyType === "cash_secured_put"
    ? leg.strike * 100 - credit * 100
    : 0;
  // Total proceeds if assigned on a covered call = (strike + premium) * 100.
  // This is the real "upside cap" — what you walk away with per contract.
  const upsideCap = plan.strategyType === "covered_call"
    ? parseFloat(((leg.strike + credit) * 100).toFixed(2))
    : null;

  return {
    symbol,
    strategy: plan.strategyType,
    strategyLabel: plan.strategyType === "cash_secured_put" ? "Cash-secured put" : "Covered call",
    bias: setup.bias,
    spot: parseFloat(spot.toFixed(2)),
    strike: leg.strike,
    optionType: leg.type,
    expiry: plan.expiry,
    dte: plan.dte,
    premiumPerShare: parseFloat(credit.toFixed(2)),
    premiumPerContract: parseFloat((credit * 100).toFixed(2)),
    collateralPerContract: parseFloat(collateral.toFixed(2)),
    upsideCapPerContract: upsideCap,
    maxProfitPerContract: parseFloat((plan.maxProfit * 100).toFixed(2)),
    maxLossPerContract: parseFloat((plan.maxLoss * 100).toFixed(2)),
    breakeven: plan.breakeven,
    delta: leg.delta,
    reasons: plan.reasons,
    warnings: plan.warnings,
    dataMode,
  };
}

const askSchema = z.object({
  question: z.string().trim().min(1).max(500),
});

const COMMON_WORDS = new Set([
  "I", "A", "AN", "IS", "IT", "TO", "OF", "IN", "ON", "AT", "BY", "DO", "MY", "ME",
  "WHY", "HOW", "WHAT", "WHEN", "WHERE", "WHO", "CAN", "SHOULD", "WILL", "WOULD",
  "THE", "AND", "OR", "FOR", "WITH", "FROM", "THIS", "THAT", "BUY", "SELL", "PUT",
  "CALL", "STOCK", "STOCKS", "TRADE", "TRADES", "PRICE", "MARKET", "OPTION", "OPTIONS",
  "SHOW", "FIND", "GIVE", "TELL", "MAKE", "GET", "USE", "TODAY", "NOW", "BEST",
  "GOOD", "BAD", "UP", "DOWN", "OUT", "RUN", "DAY", "ALL", "ANY", "BE", "ARE",
  "MOVING", "GROW", "INCOME", "RISK", "PRO", "PLAN", "AI",
]);

const TICKER_PATTERN = /\b([A-Z]{1,5})\b/g;

function extractTickers(text: string, max = 3): string[] {
  const found = new Set<string>();

  // 1) Explicit $ticker syntax in any case wins (most unambiguous).
  const dollar = text.match(/\$([A-Za-z]{1,5})\b/g) ?? [];
  for (const d of dollar) {
    const sym = d.replace("$", "").toUpperCase();
    if (!COMMON_WORDS.has(sym)) {
      found.add(sym);
      if (found.size >= max) return Array.from(found);
    }
  }

  // 2) Uppercase tokens (NVDA, AAPL).
  const upper = text.match(TICKER_PATTERN) ?? [];
  for (const t of upper) {
    if (!COMMON_WORDS.has(t) && t.length >= 1 && t.length <= 5) {
      found.add(t);
      if (found.size >= max) return Array.from(found);
    }
  }

  // 3) Case-insensitive fallback: tokenize, uppercase short alpha words,
  //    and treat them as candidate tickers (minus common words). Catches
  //    "why is nvda moving".
  const tokens = text.split(/[^A-Za-z$]+/).filter(Boolean);
  for (const tok of tokens) {
    if (tok.length < 2 || tok.length > 5) continue;
    const sym = tok.toUpperCase();
    if (COMMON_WORDS.has(sym)) continue;
    if (found.has(sym)) continue;
    found.add(sym);
    if (found.size >= max) break;
  }
  return Array.from(found);
}

function classifyIntent(q: string): "best-trade" | "income" | "growth" | "news" | "trade-idea" | "general" {
  const lower = q.toLowerCase();
  // "best trade" intent must be checked first — it's the highest-value action
  // and the phrasing overlaps with several others.
  if (
    /(best (trade|stock|option|setup|pick)s?)|(find (me )?(a |the )?(best )?trade)|(top (pick|trade|setup)s?)|(what should i (trade|buy) (now|today))|(high[- ]?probability)/.test(lower)
  ) {
    return "best-trade";
  }
  if (/(income|covered call|cash[- ]secured|premium|dividend|monthly cash|weekly income)/.test(lower)) return "income";
  if (/(grow|growth|long[- ]?term|nest egg|retire|portfolio|compound|build wealth)/.test(lower)) return "growth";
  if (/(why|news|catalyst|sentiment|moving|happening|announce|earnings|fed)/.test(lower)) return "news";
  if (/(setup|trade|entry|breakout|swing|day trade|buy|short|long|call|put|spread)/.test(lower)) return "trade-idea";
  return "general";
}

// Extracts a universe hint from a free-form question — matches the same
// universe choices offered on the Best Trade page so chat invocation is
// consistent with explicit feature use.
function detectUniverseHint(lower: string): "watchlist" | "sp_100" | "sp_500" | "nasdaq_100" | "high_volume" | "options_liquid" | "large_cap" | null {
  if (/\bwatchlist\b/.test(lower)) return "watchlist";
  if (/\bs\s*&?\s*p\s*-?\s*100\b|\bsp[\s-]?100\b|\boex\b/.test(lower)) return "sp_100";
  if (/\bs\s*&?\s*p\s*-?\s*500\b|\bsp[\s-]?500\b/.test(lower)) return "sp_500";
  if (/\bnasdaq[\s-]?100\b|\bndx\b|\bqqq\b/.test(lower)) return "nasdaq_100";
  if (/\bhigh[\s-]?volume\b|\bmost active\b|\btop volume\b/.test(lower)) return "high_volume";
  if (/\boptions?[\s-]?liquid\b|\bliquid options?\b/.test(lower)) return "options_liquid";
  if (/\bdow\s*30\b|\bdjia\b|\bblue[\s-]?chips?\b/.test(lower)) return "large_cap";
  return null;
}

function suggestionsForIntent(intent: ReturnType<typeof classifyIntent>, tickers: string[]): { label: string; href: string }[] {
  const t = tickers[0];
  switch (intent) {
    case "best-trade":
      return t
        ? [
            { label: `Build a ticket for ${t}`, href: `/trade/${t}` },
            { label: `Open ${t} chart`, href: `/charts/${t}` },
            { label: "See ranked opportunities", href: "/opportunity-radar" },
          ]
        : [
            { label: "See ranked opportunities", href: "/opportunity-radar" },
            { label: "Open Trade Builder", href: "/trade-finder" },
          ];
    case "income":
      return [
        { label: "Open Income Mode", href: "/income-mode" },
        { label: "See today's income ideas", href: "/opportunity-radar" },
      ];
    case "growth":
      return [
        { label: "Open Grow Mode", href: "/goal-mode" },
        { label: "See top growth ideas", href: "/opportunity-radar" },
      ];
    case "news":
      return t
        ? [
            { label: `View ${t} in Market Intel`, href: `/market-intel?symbol=${t}` },
            { label: `Trade ${t}`, href: `/trade/${t}` },
          ]
        : [{ label: "Open Market Intel", href: "/market-intel" }];
    case "trade-idea":
      return t
        ? [
            { label: `Build a setup for ${t}`, href: `/trade-finder?symbol=${t}` },
            { label: `Trade ${t}`, href: `/trade/${t}` },
          ]
        : [
            { label: "Open Trade Builder", href: "/trade-finder" },
            { label: "See ranked opportunities", href: "/opportunity-radar" },
          ];
    default:
      return [
        { label: "Open Trade Builder", href: "/trade-finder" },
        { label: "See ranked opportunities", href: "/opportunity-radar" },
      ];
  }
}

const SYSTEM_PROMPT = `You are VCP Trader AI, an assistant for self-directed retail traders inside the VCP Trader AI app.

Strict rules:
- You provide software-generated educational analysis. You NEVER give personalized investment advice, price predictions, or guarantees.
- Always include a brief risk note when discussing a specific trade idea.
- Keep answers concise (max ~180 words) and structured. Use plain English; avoid jargon unless asked.
- If the user mentions a ticker, anchor your answer to the supplied live quote, computed indicators (RSI, MACD, SMA/EMA, Bollinger, ATR, VWAP, volume, support/resistance), and sentiment context. Do not invent prices or invent indicator values.
- Reference indicators in plain English (e.g., "RSI is overbought near 72" or "trading above the 50-day average"). If indicators or live quote are missing, say so honestly.
- Never suggest auto-trading or autopilot behavior.

Return STRICT JSON with this exact shape:
{
  "headline": "one short sentence answering the question",
  "answer": "2-4 short paragraphs of plain-English explanation (markdown line breaks ok)",
  "keyPoints": ["bullet 1", "bullet 2", "bullet 3"],
  "riskNote": "one sentence on risk / what could go wrong",
  "confidence": "low | medium | high"
}`;

interface TickerContext {
  symbol: string;
  last: number | null;
  changePercent: number | null;
  sentimentLabel: string | null;
  sentimentScore: number | null;
  whyItMatters: string | null;
  market: MarketSnapshot | null;
}

interface ContextBlock {
  tickers: TickerContext[];
  brokerConnected: boolean;
  brokerProvider: string | null;
  intent: string;
}

async function buildContext(userId: string, question: string, intent: string, tickers: string[]): Promise<ContextBlock> {
  const ctx: ContextBlock = { tickers: [], brokerConnected: false, brokerProvider: null, intent };

  try {
    const conn = await storage.getBrokerConnectionWithToken(userId);
    ctx.brokerConnected = !!(conn && conn.isConnected && conn.accessToken);
    ctx.brokerProvider = conn?.provider ?? null;
  } catch {}

  if (tickers.length > 0) {
    // Pull sentiment + live broker market snapshots (quote + indicators) in parallel.
    const [sentimentResult, snapshots] = await Promise.all([
      refreshSentimentForSymbols(tickers, { itemsPerSymbol: 4 }).catch((err) => {
        console.warn("[ask] sentiment lookup failed:", err);
        return { snapshots: [] as any[] };
      }),
      Promise.all(tickers.map((s) => getMarketSnapshot(userId, s).catch((e) => {
        console.warn(`[ask] market snapshot failed for ${s}:`, (e as Error).message);
        return null;
      }))),
    ]);
    const sentSnaps = sentimentResult.snapshots ?? [];

    for (let i = 0; i < tickers.length; i++) {
      const sym = tickers[i];
      const snap = sentSnaps.find((s: any) => s.symbol === sym);
      const market = snapshots[i];
      ctx.tickers.push({
        symbol: sym,
        last: market?.quote?.last ?? null,
        changePercent: market?.quote?.changePercent ?? null,
        sentimentLabel: snap?.sentimentLabel ?? null,
        sentimentScore: snap?.sentimentScore ?? null,
        whyItMatters: snap?.whyItMatters ?? null,
        market: market ?? null,
      });
    }
  }

  return ctx;
}

interface AskAnswer {
  headline: string;
  answer: string;
  keyPoints: string[];
  riskNote: string;
  confidence: "low" | "medium" | "high";
}

function ruleBasedAnswer(question: string, intent: string, ctx: ContextBlock): AskAnswer {
  const t = ctx.tickers[0];
  if (intent === "news" && t) {
    const sent = t.sentimentLabel ?? "neutral";
    return {
      headline: `Recent ${t.symbol} sentiment is ${sent}.`,
      answer: t.whyItMatters
        ? `Based on recent headlines, ${t.symbol} sentiment is ${sent}. ${t.whyItMatters}`
        : `Sentiment for ${t.symbol} is currently ${sent}. Open Market Intel for the underlying headlines and a per-article breakdown.`,
      keyPoints: [
        `Sentiment label: ${sent}`,
        t.sentimentScore != null ? `Score: ${t.sentimentScore}` : "Score: unavailable",
        "Open Market Intel for the source articles.",
      ],
      riskNote: "Sentiment changes quickly. Confirm with the live chart and your own plan before acting.",
      confidence: "low",
    };
  }
  if (intent === "income") {
    return {
      headline: "Income Mode is the right starting point.",
      answer: "For monthly cash flow, the typical paths are covered calls (you own the stock and sell calls), cash-secured puts (collect premium with capital set aside), or defined-risk credit spreads. Income Mode lets you set capital, target premium, and constraints, then ranks candidates.",
      keyPoints: ["Covered calls require owning shares", "Cash-secured puts require capital", "Defined-risk spreads cap the loss"],
      riskNote: "Premium-selling caps upside and still carries downside exposure on the underlying.",
      confidence: "medium",
    };
  }
  if (intent === "growth") {
    return {
      headline: "Grow Mode walks you through a goal-based plan.",
      answer: "Tell us your starting capital, time horizon, and risk tolerance. The Strategy Agent ranks candidate scenarios with a probability grade, R/R, and a plain-English why. Every order is reviewed by you before it leaves InstaTrade™.",
      keyPoints: ["Set capital and goal", "Pick risk per trade", "Review every order before sending"],
      riskNote: "Past performance does not predict future results.",
      confidence: "medium",
    };
  }
  return {
    headline: "Here's where to look inside VCP Trader AI.",
    answer: "Use the Trade Builder to express a setup in plain English, the Opportunity Radar for ranked candidates, or Market Intel for news and sentiment. Every idea is software-generated analysis, not a recommendation.",
    keyPoints: ["Trade Builder for custom setups", "Opportunity Radar for ranked ideas", "Market Intel for news context"],
    riskNote: "All output is informational only — confirm with your own plan before trading.",
    confidence: "low",
  };
}

async function callOpenAi(question: string, ctx: ContextBlock): Promise<AskAnswer | null> {
  if (!isOpenAiConfigured()) return null;
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    // Trim context for prompt: keep only top S/R levels and key indicator values to reduce tokens.
    const compact = {
      ...ctx,
      tickers: ctx.tickers.map((t) => ({
        symbol: t.symbol,
        last: t.last,
        changePercent: t.changePercent,
        sentimentLabel: t.sentimentLabel,
        sentimentScore: t.sentimentScore,
        whyItMatters: t.whyItMatters,
        provider: t.market?.provider ?? null,
        indicators: t.market?.indicators
          ? {
              trend: t.market.indicators.trend,
              sma20: t.market.indicators.sma20,
              sma50: t.market.indicators.sma50,
              sma200: t.market.indicators.sma200,
              ema9: t.market.indicators.ema9,
              ema21: t.market.indicators.ema21,
              rsi14: t.market.indicators.rsi14,
              macd: t.market.indicators.macd,
              bollinger: t.market.indicators.bollinger,
              atr14: t.market.indicators.atr14,
              vwapSession: t.market.indicators.vwapSession,
              volume: t.market.indicators.volume,
              supports: t.market.indicators.supportResistance.support,
              resistances: t.market.indicators.supportResistance.resistance,
            }
          : null,
      })),
    };
    const userContent = JSON.stringify({ question, context: compact });
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    });
    const text = completion.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text);
    const conf = String(parsed.confidence ?? "low").toLowerCase();
    return {
      headline: typeof parsed.headline === "string" && parsed.headline.trim() ? parsed.headline.trim().slice(0, 160) : "Here's what I found.",
      answer: typeof parsed.answer === "string" ? parsed.answer.trim().slice(0, 1800) : "",
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.filter((x: any) => typeof x === "string").slice(0, 5) : [],
      riskNote: typeof parsed.riskNote === "string" ? parsed.riskNote.trim().slice(0, 280) : "All output is software-generated analysis — not investment advice.",
      confidence: conf === "high" ? "high" : conf === "medium" ? "medium" : "low",
    };
  } catch (err) {
    console.warn("[ask] openai call failed, falling back:", err);
    return null;
  }
}

export function registerAskRoutes(app: Express, isAuthenticated: RequestHandler): void {
  app.post("/api/ask", isAuthenticated, async (req: any, res) => {
    try {
      const parsed = askSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Question is required (1-500 chars)." });
      }
      const { question } = parsed.data;
      const userId = req.session?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const intent = classifyIntent(question);
      const tickers = extractTickers(question);
      const ctx = await buildContext(userId, question, intent, tickers);

      // Wheel / income / CSP / covered-call ask + a ticker → build a real
      // option ticket (strike, expiry, credit, max profit/loss) so the
      // response is actionable instead of generic prose.
      let tradeDetail: AskTradeDetail | null = null;
      // For directional long_call/long_put asks we also run a bias check so
      // we can tell the user whether the signals AGREE with their intent.
      let directionalBias: { direction: "long_call" | "long_put"; bias: "bullish" | "bearish" | "neutral"; biasReason: string } | null = null;
      try {
        const parsedPrompt = parsePrompt(question);
        if (parsedPrompt.incomeIntent && tickers.length > 0) {
          const sym = tickers[0];
          const live = ctx.tickers.find((t) => t.symbol === sym)?.last ?? null;
          tradeDetail = buildIncomeTradeDetail(sym, live, parsedPrompt.incomeIntent);
        } else {
          const dir = detectDirectionalOption(question.toLowerCase());
          if (dir && tickers.length > 0) {
            const sym = tickers[0];
            const live = ctx.tickers.find((t) => t.symbol === sym)?.last ?? null;
            // Determine bias from the same scan engine the rest of the app
            // uses (price action + news + AI sentiment). This is what makes
            // the answer respect "if bullish" qualifiers in the prompt.
            let biasMeta: { bias: "bullish" | "bearish" | "neutral"; biasReason: string } = {
              bias: "neutral",
              biasReason: `No clear directional signal on ${sym} right now from price action, news, or sentiment.`,
            };
            try {
              const biasResult: BestTradeForSymbolResult = await findBestTradesForSymbol(userId, sym);
              biasMeta = { bias: biasResult.bias, biasReason: biasResult.biasReason };
            } catch (err) {
              console.warn("[ask] directional bias check failed:", err);
            }
            const td = buildDirectionalTradeDetail(sym, live, dir);
            const wantBullish = dir === "long_call";
            const matches = (wantBullish && biasMeta.bias === "bullish") || (!wantBullish && biasMeta.bias === "bearish");
            const contrary = (wantBullish && biasMeta.bias === "bearish") || (!wantBullish && biasMeta.bias === "bullish");
            td.signalAlignment = matches ? "aligned" : contrary ? "contrary" : "neutral";
            td.signalAlignmentNote = matches
              ? `Signals on ${sym} are ${biasMeta.bias} — they support a ${wantBullish ? "long call" : "long put"}.`
              : contrary
                ? `Signals on ${sym} are ${biasMeta.bias} — the OPPOSITE of a ${wantBullish ? "long call" : "long put"}. Consider a ${wantBullish ? "long put" : "long call"} instead, or wait for the bias to shift.`
                : `Signals on ${sym} are neutral right now — a directional ${wantBullish ? "long call" : "long put"} is speculative until the bias confirms.`;
            tradeDetail = td;
            directionalBias = { direction: dir, ...biasMeta };
          }
        }
      } catch (err) {
        console.warn("[ask] trade detail build failed:", err);
      }

      // Best-trade intent. Two paths:
      //   1) A ticker is mentioned → run the per-symbol finder. It uses
      //      broker data + news + AI sentiment + built-in strategies to
      //      determine bias, then returns ONE best stock trade and ONE
      //      best defined-risk option trade.
      //   2) No ticker → fall back to a watchlist/universe scan and
      //      return the top defined-risk picks.
      let picks: BestTradePick[] = [];
      let bestTradeMeta: {
        scope: "symbol" | "universe";
        label: string;
        dataMode: "live" | "simulated" | "mixed";
        brokerConnected: boolean;
        bias?: "bullish" | "bearish" | "neutral";
        biasReason?: string;
        stockPick?: BestTradePick | null;
        optionPick?: BestTradePick | null;
      } | null = null;
      if (intent === "best-trade") {
        try {
          if (tickers.length > 0) {
            const sym = tickers[0];
            const result: BestTradeForSymbolResult = await findBestTradesForSymbol(userId, sym);
            const ordered: BestTradePick[] = [];
            if (result.stockPick) ordered.push(result.stockPick);
            if (result.optionPick) ordered.push(result.optionPick);
            picks = ordered;
            bestTradeMeta = {
              scope: "symbol",
              label: sym,
              dataMode: result.dataMode,
              brokerConnected: result.brokerConnected,
              bias: result.bias,
              biasReason: result.biasReason,
              stockPick: result.stockPick,
              optionPick: result.optionPick,
            };
          } else {
            const lower = question.toLowerCase();
            const hintedUniverse = detectUniverseHint(lower);
            const result = await findBestTrades(userId, {
              universe: hintedUniverse ?? "watchlist",
              limit: 3,
            });
            picks = result.picks;
            bestTradeMeta = {
              scope: "universe",
              label: result.universeLabel,
              dataMode: result.dataMode,
              brokerConnected: result.brokerConnected,
            };
          }
        } catch (err) {
          console.warn("[ask] best-trade scan failed:", err);
        }
      }

      let answer = await callOpenAi(question, ctx);
      const source: "openai" | "rule_based" = answer ? "openai" : "rule_based";
      if (!answer) answer = ruleBasedAnswer(question, intent, ctx);

      // For best-trade intent, override the headline/answer to reflect
      // the actual picks (or lack thereof).
      if (intent === "best-trade" && bestTradeMeta) {
        const dataLabel =
          bestTradeMeta.dataMode === "live"
            ? "live broker data"
            : bestTradeMeta.dataMode === "mixed"
              ? "a mix of live broker data and simulated examples"
              : "simulated examples";

        if (bestTradeMeta.scope === "symbol") {
          const sym = bestTradeMeta.label;
          const stock = bestTradeMeta.stockPick ?? null;
          const opt = bestTradeMeta.optionPick ?? null;
          const biasText = bestTradeMeta.bias ?? "neutral";
          if (stock || opt) {
            const parts: string[] = [];
            if (stock) {
              parts.push(
                `Best stock trade: ${stock.strategyLabel} (${stock.confidence}% confidence, R/R ${stock.rewardRisk.toFixed(2)}:1, max loss $${stock.maxLoss.toLocaleString()}).`,
              );
            }
            if (opt) {
              parts.push(
                `Best option trade: ${opt.strategyLabel} (${opt.confidence}% confidence, max loss $${opt.maxLoss.toLocaleString()}${opt.expiration ? `, expires ${opt.expiration}` : ""}).`,
              );
            }
            const top = stock ?? opt!;
            answer = {
              ...answer,
              headline: `${sym} looks ${biasText} — here are the best stock and option trades.`,
              answer: `Using ${dataLabel}, news headlines, and AI sentiment, ${sym} is reading ${biasText}. ${bestTradeMeta.biasReason ?? ""}\n\n${parts.join("\n")}\n\nReview both before acting — nothing is sent to your broker without your explicit approval.`,
              riskNote: top.mainRisk,
              confidence: top.confidence >= 80 ? "high" : top.confidence >= 65 ? "medium" : "low",
            };
          } else {
            answer = {
              ...answer,
              headline: `No qualifying trade on ${sym} right now.`,
              answer: `I scanned ${sym} using ${dataLabel} plus news and AI sentiment. The combined signals didn't produce a stock or defined-risk option setup that meets the minimum grade. Try again later or check the chart and news directly.`,
              confidence: "low",
            };
          }
        } else {
          // Universe scan (no specific ticker mentioned).
          const where = bestTradeMeta.label;
          if (picks.length > 0) {
            const top = picks[0];
            answer = {
              ...answer,
              headline: `Top defined-risk pick across ${where}: ${top.symbol} (${top.strategyLabel}, ${top.confidence}% confidence)`,
              answer: `Scanned ${where} using ${dataLabel} and ranked defined-risk candidates only (no naked long calls/puts). Top pick is ${top.symbol} — ${top.thesis} ${top.mainReason}\n\nAsk about a specific ticker (e.g. "Find a high-probability trade on NVDA") to get one stock + one option trade with bias analysis.`,
              riskNote: top.mainRisk,
              confidence: top.confidence >= 80 ? "high" : top.confidence >= 65 ? "medium" : "low",
            };
          } else {
            answer = {
              ...answer,
              headline: "No defined-risk picks meet the threshold right now.",
              answer: `I scanned ${where} for defined-risk setups (stocks with stops, debit spreads, covered calls, cash-secured puts) and nothing crossed the confidence floor. Try asking about a specific ticker (e.g. "best trade on AAPL").`,
              confidence: "low",
            };
          }
        }
      }

      // Directional debit ticket (long call / long put) — override the AI
      // prose with bias-aware language and concrete strikes/debit.
      if (tradeDetail && (tradeDetail.strategy === "long_call" || tradeDetail.strategy === "long_put") && directionalBias) {
        const td = tradeDetail;
        const isCall = td.strategy === "long_call";
        const wantWord = isCall ? "bullish" : "bearish";
        const dirLabel = isCall ? "long call" : "long put";
        const sentenceData = td.dataMode === "live"
          ? `${td.symbol} is at $${td.spot.toFixed(2)}.`
          : `Using a simulated price baseline of $${td.spot.toFixed(2)} (no live quote available).`;
        const aligned = td.signalAlignment === "aligned";
        const contrary = td.signalAlignment === "contrary";
        const biasSentence = aligned
          ? `Signals on ${td.symbol} are reading ${directionalBias.bias} — that supports a ${dirLabel}. ${directionalBias.biasReason}`
          : contrary
            ? `Heads-up: signals on ${td.symbol} are reading ${directionalBias.bias} — the OPPOSITE of a ${dirLabel}. ${directionalBias.biasReason} I'm still showing the ${dirLabel} ticket below since you asked, but the current evidence does not back it.`
            : `Signals on ${td.symbol} are neutral right now — no clear ${wantWord} confirmation. ${directionalBias.biasReason} A ${dirLabel} here is speculative until the bias confirms.`;
        const planSentence = `Buy 1× ${td.expiry} ${td.symbol} $${td.strike} ${td.optionType} for about $${td.premiumPerShare.toFixed(2)} per share — roughly $${td.premiumPerContract.toFixed(0)} debit per contract. Max loss is the debit paid ($${td.maxLossPerContract.toFixed(0)} per contract). Breakeven at expiry: $${td.breakeven.toFixed(2)}.`;
        const headline = aligned
          ? `${td.symbol} looks ${directionalBias.bias} — buy the $${td.strike} ${td.optionType} expiring ${td.expiry}`
          : contrary
            ? `${td.symbol} signals are ${directionalBias.bias} — a ${dirLabel} is contrary to the read`
            : `${td.symbol} bias is unclear — speculative ${dirLabel} ticket below`;
        answer = {
          ...answer,
          headline,
          answer: `${sentenceData}\n\n${biasSentence}\n\n${planSentence}`,
          keyPoints: [
            `Bias read: ${directionalBias.bias} (${td.signalAlignment === "aligned" ? "supports" : td.signalAlignment === "contrary" ? "contradicts" : "neutral on"} this ${dirLabel})`,
            `Strike: $${td.strike} ${td.optionType} (~${Math.round(Math.abs(td.delta) * 100)} delta)`,
            `Expiry: ${td.expiry} (${td.dte} days)`,
            `Debit: ~$${td.premiumPerContract.toFixed(0)} per contract (also your max loss)`,
            `Breakeven: $${td.breakeven.toFixed(2)}`,
          ],
          riskNote: `Long ${td.optionType}s lose value to time decay every day. Max loss is the full debit (~$${td.maxLossPerContract.toFixed(0)} per contract) if ${td.symbol} doesn't move in your favor by ${td.expiry}. Strikes/premium are approximate — confirm in your broker before sending.`,
          confidence: aligned ? "medium" : contrary ? "low" : "low",
        };
      } else if (tradeDetail) {
        // CSP / Covered-call (wheel) ticket — credit-collecting flow.
        const td = tradeDetail;
        const isCsp = td.strategy === "cash_secured_put";
        const verbAction = isCsp ? "Sell" : "Sell";
        const headline = isCsp
          ? `${td.symbol} wheel — sell the $${td.strike} put expiring ${td.expiry}`
          : `${td.symbol} wheel — sell the $${td.strike} call expiring ${td.expiry}`;
        const sentenceData = td.dataMode === "live"
          ? `${td.symbol} is at $${td.spot.toFixed(2)}.`
          : `Using a simulated price baseline of $${td.spot.toFixed(2)} (no live quote available).`;
        const sentencePlan = isCsp
          ? `${verbAction} 1× ${td.expiry} ${td.symbol} $${td.strike} put for about $${td.premiumPerShare.toFixed(2)} per share — roughly $${td.premiumPerContract.toFixed(0)} credit per contract. Cash collateral required: about $${td.collateralPerContract.toFixed(0)}.`
          : `${verbAction} 1× ${td.expiry} ${td.symbol} $${td.strike} call against 100 shares you own for about $${td.premiumPerShare.toFixed(2)} per share — roughly $${td.premiumPerContract.toFixed(0)} credit per contract.`;
        const sentenceOutcome = isCsp
          ? `If ${td.symbol} stays above $${td.strike} by expiry, you keep the $${td.premiumPerContract.toFixed(0)} premium. If it drops below, you're assigned 100 shares at $${td.strike} (effective cost basis ~$${td.breakeven.toFixed(2)}) — a typical wheel entry.`
          : `If ${td.symbol} stays below $${td.strike} by expiry, you keep the $${td.premiumPerContract.toFixed(0)} premium. If it closes above, your shares are called away at $${td.strike}.`;
        answer = {
          ...answer,
          headline,
          answer: `${sentenceData}\n\n${sentencePlan}\n\n${sentenceOutcome}`,
          keyPoints: [
            `Strike: $${td.strike} ${td.optionType} (~${Math.round(Math.abs(td.delta) * 100)} delta)`,
            `Expiry: ${td.expiry} (${td.dte} days)`,
            `Premium: ~$${td.premiumPerContract.toFixed(0)} per contract`,
            isCsp
              ? `Collateral: ~$${td.collateralPerContract.toFixed(0)} per contract`
              : `Max proceeds if assigned: ~$${(td.upsideCapPerContract ?? 0).toFixed(0)} per contract (capped at $${td.strike})`,
            `Breakeven: $${td.breakeven.toFixed(2)}`,
          ],
          riskNote: isCsp
            ? `If ${td.symbol} drops well below $${td.strike}, you're still obligated to buy at the strike. Max loss per contract is about $${td.maxLossPerContract.toFixed(0)} (stock to $0). Premium is approximate — confirm in your broker.`
            : `Premium offsets some downside but does not protect against a meaningful drop in the shares. Max loss per contract is about $${td.maxLossPerContract.toFixed(0)}. Premium is approximate — confirm in your broker.`,
          confidence: "medium",
        };
      }

      res.json({
        question,
        intent,
        tickers,
        brokerConnected: ctx.brokerConnected,
        ...answer,
        picks,
        tradeDetail,
        suggestions: suggestionsForIntent(intent, tickers),
        source,
        disclaimer: "Software-generated educational analysis — not investment advice. Confirm everything in your own broker before acting.",
      });
    } catch (err: any) {
      console.error("[POST /api/ask]", err);
      res.status(500).json({ error: "Failed to generate answer" });
    }
  });
}
