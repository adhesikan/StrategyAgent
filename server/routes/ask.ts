import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { refreshSentimentForSymbols, isOpenAiConfigured } from "../services/news";
import { getMarketSnapshot, type MarketSnapshot } from "../services/market-data";
import { findBestTrades, type BestTradePick } from "../services/best-trade-finder";

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
      return [
        { label: "Open Find My Best Trade", href: "/best-trade" },
        { label: "See ranked opportunities", href: "/opportunity-radar" },
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

      // Best-trade intent: scan defined-risk candidates and surface picks
      // alongside the AI answer so the chat result feels actionable. Detect
      // universe hints in the question so chat invocation matches the same
      // user-selectable universe behavior as the main feature.
      let picks: BestTradePick[] = [];
      let bestTradeMeta: { universeLabel: string; dataMode: "live" | "simulated" | "mixed"; brokerConnected: boolean } | null = null;
      if (intent === "best-trade") {
        try {
          const lower = question.toLowerCase();
          const hintedUniverse = detectUniverseHint(lower);
          const useCustom = tickers.length > 0 && !hintedUniverse;
          const result = await findBestTrades(userId, {
            universe: useCustom ? "custom" : (hintedUniverse ?? "watchlist"),
            customSymbols: useCustom ? tickers : undefined,
            limit: 3,
          });
          picks = result.picks;
          bestTradeMeta = {
            universeLabel: result.universeLabel,
            dataMode: result.dataMode,
            brokerConnected: result.brokerConnected,
          };
        } catch (err) {
          console.warn("[ask] best-trade scan failed:", err);
        }
      }

      let answer = await callOpenAi(question, ctx);
      const source: "openai" | "rule_based" = answer ? "openai" : "rule_based";
      if (!answer) answer = ruleBasedAnswer(question, intent, ctx);

      // For best-trade intent, override the headline/answer when picks exist
      // so the chat directly reflects what was found.
      if (intent === "best-trade" && picks.length > 0 && bestTradeMeta) {
        const top = picks[0];
        const dataLabel =
          bestTradeMeta.dataMode === "live"
            ? "live broker data"
            : bestTradeMeta.dataMode === "mixed"
              ? "a mix of live broker data and simulated examples"
              : "simulated examples";
        answer = {
          ...answer,
          headline: `Top defined-risk pick: ${top.symbol} (${top.strategyLabel}, ${top.confidence}% confidence)`,
          answer: `Scanned ${bestTradeMeta.universeLabel} using ${dataLabel} and ranked defined-risk candidates only (no naked long calls/puts). The top pick is ${top.symbol} — ${top.thesis} ${top.mainReason}`,
          riskNote: top.mainRisk,
          confidence: top.confidence >= 80 ? "high" : top.confidence >= 65 ? "medium" : "low",
        };
      } else if (intent === "best-trade" && picks.length === 0) {
        const where = bestTradeMeta?.universeLabel ?? "your watchlist";
        answer = {
          ...answer,
          headline: "No defined-risk picks meet the threshold right now.",
          answer: `I scanned ${where} for defined-risk setups (stocks with stops, debit spreads, covered calls, cash-secured puts) and nothing crossed the 65% confidence floor. Open Find My Best Trade to broaden the universe (S&P 100, Nasdaq 100, high-volume names) or lower the confidence threshold.`,
          confidence: "low",
        };
      }

      res.json({
        question,
        intent,
        tickers,
        brokerConnected: ctx.brokerConnected,
        ...answer,
        picks,
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
