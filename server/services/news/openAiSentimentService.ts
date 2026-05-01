/**
 * OpenAI gpt-4o-mini sentiment analyzer.
 *
 * Returns strict JSON. Falls back to rule-based keyword scoring when OPENAI_API_KEY is missing.
 *
 * Notes:
 * - The OpenAI SDK is loaded lazily so the server can boot without the key.
 * - Calls use response_format: { type: "json_object" } for safer parsing.
 */

import type { NormalizedArticle } from "./stockNewsService";

export type SentimentLabel = "bullish" | "bearish" | "neutral" | "mixed";
export type ImpactLevel = "low" | "medium" | "high";
export type ArticleTimeHorizon = "intraday" | "swing" | "long_term";

export interface AnalyzedArticle {
  sentimentLabel: SentimentLabel;
  sentimentScore: number; // -100..100
  confidence: number; // 0..100
  impactLevel: ImpactLevel;
  timeHorizon: ArticleTimeHorizon;
  summary: string;
  whyItMatters: string;
  bullishDrivers: string[];
  bearishDrivers: string[];
  riskWarnings: string[];
  affectedSymbols: string[];
  source: "openai" | "rule_based";
}

export function isOpenAiConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

const PROMPT_SYSTEM = `You are a financial news sentiment engine for self-directed traders.

Return ONLY valid JSON with this exact shape:
{
  "sentimentLabel": "bullish | bearish | neutral | mixed",
  "sentimentScore": number between -100 and 100,
  "confidence": number between 0 and 100,
  "impactLevel": "low | medium | high",
  "timeHorizon": "intraday | swing | long_term",
  "summary": "max 2 sentences plain English",
  "whyItMatters": "why traders may care",
  "bullishDrivers": [string],
  "bearishDrivers": [string],
  "riskWarnings": [string],
  "affectedSymbols": [string]
}

Rules:
- No investment advice or recommendations
- No buy/sell language
- Focus on informational market impact
- Be concise`;

const RULE_BULLISH = [
  "beat", "beats", "upgrade", "upgraded", "record high", "all-time high", "outperform", "outperformed",
  "buyback", "raises guidance", "strong demand", "expansion", "approval", "approved", "wins", "win",
  "ai demand", "ai capex", "partnership", "acquires", "expanding", "growth", "surge", "soars",
];
const RULE_BEARISH = [
  "miss", "misses", "downgrade", "downgraded", "lawsuit", "investigation", "recall", "decline",
  "weak demand", "lowers guidance", "cuts", "layoffs", "fraud", "probe", "scandal", "ban",
  "warning", "slumps", "plunges", "tumbles", "bankruptcy", "delisted", "halt", "halted",
];

function ruleBasedAnalyze(article: NormalizedArticle): AnalyzedArticle {
  const haystack = `${article.headline} ${article.summary}`.toLowerCase();
  let bull = 0;
  let bear = 0;
  const bullishDrivers: string[] = [];
  const bearishDrivers: string[] = [];
  for (const w of RULE_BULLISH) {
    if (haystack.includes(w)) {
      bull += 1;
      if (bullishDrivers.length < 3) bullishDrivers.push(`Mentions "${w}"`);
    }
  }
  for (const w of RULE_BEARISH) {
    if (haystack.includes(w)) {
      bear += 1;
      if (bearishDrivers.length < 3) bearishDrivers.push(`Mentions "${w}"`);
    }
  }

  let label: SentimentLabel = "neutral";
  let score = 0;
  if (bull > 0 && bear > 0 && Math.abs(bull - bear) <= 1) {
    label = "mixed";
    score = (bull - bear) * 10;
  } else if (bull > bear) {
    label = "bullish";
    score = Math.min(80, 25 + (bull - bear) * 15);
  } else if (bear > bull) {
    label = "bearish";
    score = Math.max(-80, -25 - (bear - bull) * 15);
  }
  const totalHits = bull + bear;
  const confidence = totalHits === 0 ? 35 : Math.min(75, 40 + totalHits * 8);
  const impactLevel: ImpactLevel = totalHits >= 3 ? "high" : totalHits >= 1 ? "medium" : "low";

  return {
    sentimentLabel: label,
    sentimentScore: score,
    confidence,
    impactLevel,
    timeHorizon: "swing",
    summary: article.summary
      ? article.summary.split(/[.!?]/).slice(0, 2).join(".").trim() + "."
      : article.headline,
    whyItMatters:
      label === "bullish"
        ? "Headline contains constructive cues that may attract attention."
        : label === "bearish"
          ? "Headline contains negative cues that may pressure short-term sentiment."
          : "Headline appears informational without strong directional cues.",
    bullishDrivers,
    bearishDrivers,
    riskWarnings: [],
    affectedSymbols: article.symbols.slice(0, 5),
    source: "rule_based",
  };
}

function clampNumber(n: any, min: number, max: number, fallback: number): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

function pickLabel(v: any): SentimentLabel {
  const allowed: SentimentLabel[] = ["bullish", "bearish", "neutral", "mixed"];
  return allowed.includes(v) ? v : "neutral";
}

function pickImpact(v: any): ImpactLevel {
  const allowed: ImpactLevel[] = ["low", "medium", "high"];
  return allowed.includes(v) ? v : "low";
}

function pickHorizon(v: any): ArticleTimeHorizon {
  const allowed: ArticleTimeHorizon[] = ["intraday", "swing", "long_term"];
  return allowed.includes(v) ? v : "swing";
}

function asStringArray(v: any, max = 6): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.trim().length > 0).slice(0, max);
}

export async function analyzeArticle(article: NormalizedArticle): Promise<AnalyzedArticle> {
  if (!isOpenAiConfigured()) {
    return ruleBasedAnalyze(article);
  }
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const userContent = JSON.stringify({
      headline: article.headline,
      summary: article.summary,
      source: article.source,
      symbols: article.symbols,
      publishedAt: article.publishedAt,
    });
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: PROMPT_SYSTEM },
        { role: "user", content: userContent },
      ],
    });
    const text = completion.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text);
    return {
      sentimentLabel: pickLabel(parsed.sentimentLabel),
      sentimentScore: clampNumber(parsed.sentimentScore, -100, 100, 0),
      confidence: clampNumber(parsed.confidence, 0, 100, 50),
      impactLevel: pickImpact(parsed.impactLevel),
      timeHorizon: pickHorizon(parsed.timeHorizon),
      summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 400) : article.headline,
      whyItMatters: typeof parsed.whyItMatters === "string" ? parsed.whyItMatters.slice(0, 400) : "",
      bullishDrivers: asStringArray(parsed.bullishDrivers),
      bearishDrivers: asStringArray(parsed.bearishDrivers),
      riskWarnings: asStringArray(parsed.riskWarnings),
      affectedSymbols: asStringArray(parsed.affectedSymbols, 10).map((s) => s.toUpperCase()),
      source: "openai",
    };
  } catch (err) {
    console.warn("[openAiSentiment] analyzeArticle fell back to rule-based:", err);
    return ruleBasedAnalyze(article);
  }
}
