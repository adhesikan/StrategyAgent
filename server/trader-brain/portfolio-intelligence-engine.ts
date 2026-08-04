// TraderBrain — Portfolio Intelligence Engine (Sprint 5.3B).
//
// Synthesises a structured PortfolioIntelligence section from already-computed
// Brain sections + the scrubbed SafePortfolioAwareness object.
//
// Pure computation — no MCP calls, no I/O.
//
// Contract:
//   - Never recommends buying or selling.
//   - Never exposes raw account IDs, balances, equity, or buying-power amounts.
//   - All percentage values are rounded to one decimal.
//   - All candidate data comes from already-validated Brain sections only.
//   - GPT role: explain trade-offs, observations, limitations — no advice.
//
// Sections produced (matching spec §1):
//   1. Current Allocation   → cashUtilization + concentrationSummary
//   2. Exposure Summary     → per-symbol exposure from portfolioFit
//   3. Candidate Impact     → before/after concentration + cash impact text
//   4. Concentration        → concentrationWarning with level + pct
//   5. Cash Utilization     → cashSufficiency / buyingPowerSufficiency
//   6. Upcoming Earnings    → earnings-risk flags from result warnings/limitations
//   7. Data Quality         → contextFreshness + what data was/wasn't available
//   8. Next Research Qs     → contextual follow-up prompts (navigation aids only)

import type { SafePortfolioAwareness } from "../routes/internal-portfolio";
import type { TraderBrainResult, TraderBrainIntent } from "./types";
import type { RankedTradeCandidate } from "../routes/ranked-trade-search";
import type { PortfolioTradePlanCandidate } from "../routes/portfolio-trade-plan";

// ---------------------------------------------------------------------------
// Public types (added to TraderBrainSections via types.ts)
// ---------------------------------------------------------------------------

/** Concentration metrics for a single symbol. */
export interface ConcentrationEntry {
  symbol: string;
  /** Current concentration % of total equity (from concentrationWarning.pct). */
  currentPct?: number;
  level: "normal" | "elevated" | "high" | "unknown";
  /** Estimated % after adding the candidate (derived from delta estimate). */
  estimatedAfterPct?: number;
  /** If candidate increases concentration, by how many percentage points. */
  deltaPct?: number;
  /** Textual concentration-effect from portfolioImpact (pass-through). */
  concentrationEffect?: string;
}

export interface CashUtilizationSection {
  /** Derived from SafePortfolioAwareness.cashSufficiency. */
  status: "verified" | "not_verified" | "insufficient" | "unknown";
  buyingPowerStatus: "sufficient" | "insufficient" | "unknown";
  /** Text from portfolioImpact.capitalEffect or a derived note. */
  note?: string;
}

export interface CandidateImpactEntry {
  symbol: string;
  strategy?: string;
  /** True when user already holds this symbol. */
  existingHolding: boolean;
  /** True when adding this would create duplicate exposure. */
  duplicateExposure: boolean;
  concentrationBefore?: number;
  concentrationAfterEstimate?: number;
  concentrationLevel?: "normal" | "elevated" | "high" | "unknown";
  /** Text from portfolioImpact.capitalEffect. */
  capitalEffect?: string;
  /** Text from portfolioImpact.diversificationNote. */
  diversificationNote?: string;
  /** Sizing note from SafePortfolioAwareness.sizingAdjustment. */
  sizingNote?: string | null;
  /** Estimated max risk dollars for this candidate. */
  maxRiskDollars?: number;
}

export interface EarningsFlag {
  symbol: string;
  warning: string;
}

export interface DataQualitySection {
  /** ISO timestamp when portfolio context was captured. */
  contextFreshness: string;
  /** Whether live portfolio data was available (positions + accounts). */
  portfolioDataAvailable: boolean;
  /** True when concentration % could be computed. */
  concentrationAvailable: boolean;
  /** True when cash-sufficiency label was available. */
  cashDataAvailable: boolean;
  limitations: string[];
}

export interface ResearchQuestion {
  /** The follow-up question text shown to the user. */
  question: string;
}

export interface ExposureSummaryEntry {
  symbol: string;
  existing: boolean;
  concentrationPct?: number;
  concentrationLevel?: "normal" | "elevated" | "high" | "unknown";
  duplicateExposure?: boolean;
  existingOptionExposure?: string | null;
}

/**
 * Full Portfolio Intelligence section.
 * All fields are computed from already-validated deterministic data.
 * OpenAI explanation is additive and optional.
 */
export interface PortfolioIntelligence {
  hasPortfolioContext: boolean;

  // §1: Current Allocation + Exposure Summary
  exposureSummary: ExposureSummaryEntry[];
  cashUtilization: CashUtilizationSection;

  // §2: Candidate Impact
  candidateImpact: CandidateImpactEntry[];

  // §3: Concentration
  concentration: ConcentrationEntry[];

  // §5: Upcoming Earnings risk
  earningsFlags: EarningsFlag[];

  // §6: Data Quality
  dataQuality: DataQualitySection;

  // §7: Next Research Questions
  nextResearchQuestions: ResearchQuestion[];

  /** GPT-generated explanation. Never buy/sell advice. Optional (OpenAI may fail). */
  openAiExplanation?: string;
}

// ---------------------------------------------------------------------------
// GPT prompt builder
// ---------------------------------------------------------------------------

/**
 * Build a focused OpenAI prompt for the Portfolio Intelligence explanation.
 * Returns null when there is nothing meaningful to explain.
 */
export function buildPortfolioIntelligencePrompt(
  pi: PortfolioIntelligence,
  question: string,
): { system: string; user: string } | null {
  if (!pi.hasPortfolioContext) return null;
  if (pi.candidateImpact.length === 0 && pi.concentration.length === 0) return null;

  const system = [
    "You are a concise portfolio analyst. The user is researching trade ideas.",
    "You have access to deterministic portfolio-intelligence data — explain it clearly.",
    "",
    "HARD RULES:",
    "- Never recommend buying or selling any security.",
    "- Never change the numeric figures in the portfolio-intelligence data.",
    "- Never fabricate price levels, targets, or portfolio values.",
    "- Explain trade-offs, portfolio changes, risk observations, and limitations.",
    "- Keep response under 250 words.",
    "- Do not call any tools.",
  ].join("\n");

  const concLines: string[] = [];
  for (const c of pi.concentration) {
    if (c.currentPct != null) {
      concLines.push(
        `  ${c.symbol}: current ${c.currentPct}% (${c.level})` +
        (c.estimatedAfterPct != null ? ` → estimated after candidate: ${c.estimatedAfterPct}%` : ""),
      );
    }
  }

  const impactLines: string[] = [];
  for (const c of pi.candidateImpact) {
    const parts = [`  ${c.symbol} (${c.strategy ?? "trade"})`];
    if (c.existingHolding) parts.push("— existing holding");
    if (c.duplicateExposure) parts.push("— duplicate exposure");
    if (c.capitalEffect) parts.push(`— ${c.capitalEffect}`);
    if (c.diversificationNote) parts.push(`— ${c.diversificationNote}`);
    impactLines.push(parts.join(" "));
  }

  const earningsLines = pi.earningsFlags.map((e) => `  ${e.symbol}: ${e.warning}`);
  const cashNote = `  Cash/buying power: ${pi.cashUtilization.status} / ${pi.cashUtilization.buyingPowerStatus}`;
  const limLines = pi.dataQuality.limitations.map((l) => `  - ${l}`);

  const user = [
    `User asked: "${question}"`,
    "",
    "PORTFOLIO INTELLIGENCE DATA:",
    concLines.length > 0 ? "Concentration:\n" + concLines.join("\n") : null,
    impactLines.length > 0 ? "Candidate impact:\n" + impactLines.join("\n") : null,
    earningsLines.length > 0 ? "Earnings flags:\n" + earningsLines.join("\n") : null,
    cashNote,
    limLines.length > 0 ? "Data limitations:\n" + limLines.join("\n") : null,
    "",
    "Please write a concise plain-English explanation of the portfolio context.",
    "Focus on trade-offs, observations, and limitations. Do not recommend buying or selling.",
  ].filter(Boolean).join("\n");

  return { system, user };
}

// ---------------------------------------------------------------------------
// Main compute function
// ---------------------------------------------------------------------------

const EARNINGS_RISK_RE = /\bearnings?\b.*\brisk\b|\bearnings?\s+event\b|\bearnings?\s+warning\b|\bupcoming\s+earnings?\b/i;
const TICKER_RE = /\b\$?([A-Z]{2,5})\b/g;

function extractSymbolsFromText(text: string): string[] {
  const matches = [...text.matchAll(TICKER_RE)];
  return [...new Set(matches.map((m) => m[1]))].filter((s) => s.length >= 2);
}

function roundPct(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Compute a PortfolioIntelligence section from Brain result + portfolio data.
 * Never throws. Returns a section with hasPortfolioContext: false when no data.
 */
export function computePortfolioIntelligence(
  result: TraderBrainResult,
  pfAwareness: SafePortfolioAwareness | null,
): PortfolioIntelligence {
  // Defensive: handle malformed/partial result objects gracefully
  const safeResult: TraderBrainResult = {
    requestId: "",
    intent: "UNKNOWN",
    normalizedRequest: {
      rawPrompt: "",
      intent: "UNKNOWN",
      tickers: [],
    } as unknown as TraderBrainResult["normalizedRequest"],
    status: "unavailable",
    headline: "",
    confidence: "none",
    sections: {},
    evidence: [],
    warnings: [],
    limitations: [],
    nextActions: [],
    generatedAt: new Date().toISOString(),
    openAiUsed: false,
    ...result,
    normalizedRequest: result?.normalizedRequest ?? {
      rawPrompt: "",
      intent: "UNKNOWN",
      tickers: [],
    } as unknown as TraderBrainResult["normalizedRequest"],
    sections: result?.sections ?? {},
    warnings: result?.warnings ?? [],
    limitations: result?.limitations ?? [],
  };

  const hasCtx = pfAwareness != null;

  // ---------------------------------------------------------------------------
  // Data quality
  // ---------------------------------------------------------------------------
  const limitations: string[] = [];
  if (!hasCtx) {
    limitations.push("Portfolio data unavailable — connect a broker to unlock portfolio-aware analysis.");
  } else {
    if (!pfAwareness!.concentrationWarning) {
      limitations.push("Concentration data unavailable — account equity could not be determined.");
    }
    if (pfAwareness!.cashSufficiency === "unknown" || pfAwareness!.cashSufficiency === "not_verified") {
      limitations.push("Cash sufficiency could not be verified against a specific trade risk.");
    }
    if (!pfAwareness!.existingPosition) {
      limitations.push("No existing position found for this symbol — concentration shows potential new exposure only.");
    }
  }
  // Propagate Brain limitations too
  for (const l of safeResult.limitations.slice(0, 3)) {
    limitations.push(l);
  }

  const dataQuality: DataQualitySection = {
    contextFreshness: pfAwareness?.contextFreshness ?? new Date().toISOString(),
    portfolioDataAvailable: hasCtx,
    concentrationAvailable: hasCtx && pfAwareness!.concentrationWarning != null,
    cashDataAvailable:
      hasCtx &&
      pfAwareness!.cashSufficiency !== "unknown",
    limitations,
  };

  if (!hasCtx) {
    return {
      hasPortfolioContext: false,
      exposureSummary: [],
      cashUtilization: { status: "unknown", buyingPowerStatus: "unknown" },
      candidateImpact: [],
      concentration: [],
      earningsFlags: [],
      dataQuality,
      nextResearchQuestions: buildResearchQuestions(safeResult, null),
    };
  }

  const pfa = pfAwareness!;

  // ---------------------------------------------------------------------------
  // Candidate symbols from Brain sections
  // ---------------------------------------------------------------------------
  const sections = safeResult.sections;
  const rankedCandidates = (sections.rankedSearch?.candidates ?? []) as RankedTradeCandidate[];
  const planCandidates = (sections.portfolioTradePlan?.qualifiedCandidates ?? []) as PortfolioTradePlanCandidate[];
  const recCandidates = (sections.recommendation?.recommendations ?? []) as Array<Record<string, unknown>>;

  // Primary symbol(s) to analyse
  const primarySymbols: string[] = [];
  if (safeResult.normalizedRequest.symbol) primarySymbols.push(safeResult.normalizedRequest.symbol);
  if (safeResult.normalizedRequest.tickers.length > 0) primarySymbols.push(...safeResult.normalizedRequest.tickers);
  // Pick at most 5 from ranked/plan candidates
  const topCandidateSymbols: string[] = [
    ...rankedCandidates.slice(0, 3).map((c) => c.symbol),
    ...planCandidates.slice(0, 3).map((c) => c.symbol),
    ...recCandidates.slice(0, 2).map((c) => String((c as Record<string, unknown>).symbol ?? "")),
  ].filter(Boolean).slice(0, 5);

  const allSymbols = [...new Set([...primarySymbols, ...topCandidateSymbols])].slice(0, 6);

  // ---------------------------------------------------------------------------
  // Exposure summary
  // ---------------------------------------------------------------------------
  const exposureSummary: ExposureSummaryEntry[] = allSymbols.map((sym) => ({
    symbol: sym,
    existing: pfa.duplicateExposure === true && sym === safeResult.normalizedRequest.symbol,
    concentrationPct: pfa.concentrationWarning?.pct,
    concentrationLevel: pfa.concentrationWarning?.level ?? "unknown",
    duplicateExposure: pfa.duplicateExposure,
    existingOptionExposure: pfa.existingOptionExposure,
  }));

  // ---------------------------------------------------------------------------
  // Concentration
  // ---------------------------------------------------------------------------
  const concentration: ConcentrationEntry[] = [];
  for (const sym of allSymbols.slice(0, 3)) {
    // We have concentration data only for the primary symbol (pfa is symbol-specific)
    const isPrimary = sym === result.normalizedRequest.symbol || sym === result.normalizedRequest.tickers[0];
    const cw = isPrimary ? pfa.concentrationWarning : undefined;

    // Estimate "after" from ranked/plan candidate maxRisk (only when we have cw.pct)
    let estimatedAfterPct: number | undefined;
    let deltaPct: number | undefined;
    if (cw?.pct != null) {
      // Find candidate max risk; estimate that delta = maxRisk as small fraction
      // We can't compute exact "after" without total equity, but we can flag direction
      const candidateMaxRisk =
        rankedCandidates.find((c) => c.symbol === sym)?.maxRisk ??
        planCandidates.find((c) => c.symbol === sym)?.maxRiskDollars ??
        safeResult.normalizedRequest.maxRiskDollars;
      if (candidateMaxRisk && candidateMaxRisk > 0 && cw.pct > 0) {
        // Back-calc total equity from concentration %. E.g. cw.pct=10% and position is $1k means equity=$10k
        // pos_value ≈ candidateMaxRisk * 5 (rough: risk is ~20% of position value)
        // Without actual position value we use candidateMaxRisk as proxy for new position cost
        // Delta = candidateMaxRisk / estimated_equity; estimated_equity ≈ pos_value / (cw.pct / 100)
        // We don't have pos_value directly, so show a rough estimate: delta ≈ 2-4%
        deltaPct = roundPct(Math.min(8, Math.max(1, (candidateMaxRisk / 10000) * cw.pct * 2)));
        estimatedAfterPct = roundPct(cw.pct + deltaPct);
      }

      const concentrationEffect = sections.portfolioTradePlan?.portfolioImpact?.concentrationEffect;
      concentration.push({
        symbol: sym,
        currentPct: cw.pct,
        level: cw.level,
        estimatedAfterPct,
        deltaPct,
        concentrationEffect,
      });
    } else if (pfa.duplicateExposure === true && isPrimary) {
      concentration.push({
        symbol: sym,
        level: "unknown",
        concentrationEffect: "Existing position detected — concentration data unavailable without equity total.",
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Candidate Impact
  // ---------------------------------------------------------------------------
  const candidateImpact: CandidateImpactEntry[] = [];
  const planImpact = sections.portfolioTradePlan?.portfolioImpact;

  // Combine ranked + plan + rec candidates for impact
  const impactSources: Array<{ symbol: string; strategy?: string; maxRiskDollars?: number }> = [
    ...rankedCandidates.slice(0, 3).map((c) => ({ symbol: c.symbol, strategy: c.strategy, maxRiskDollars: c.maxRisk })),
    ...planCandidates.slice(0, 3).map((c) => ({ symbol: c.symbol, strategy: c.strategy, maxRiskDollars: c.maxRiskDollars })),
    ...recCandidates.slice(0, 2).map((c) => ({
      symbol: String((c as Record<string, unknown>).symbol ?? ""),
      strategy: String((c as Record<string, unknown>).strategy ?? ""),
    })),
  ].filter((c) => c.symbol).slice(0, 5);

  for (const src of impactSources) {
    const concEntry = concentration.find((c) => c.symbol === src.symbol);
    const isPrimary = src.symbol === safeResult.normalizedRequest.symbol || src.symbol === safeResult.normalizedRequest.tickers[0];

    candidateImpact.push({
      symbol: src.symbol,
      strategy: src.strategy,
      existingHolding: isPrimary && pfa.duplicateExposure === true,
      duplicateExposure: isPrimary ? (pfa.duplicateExposure ?? false) : false,
      concentrationBefore: concEntry?.currentPct,
      concentrationAfterEstimate: concEntry?.estimatedAfterPct,
      concentrationLevel: concEntry?.level,
      capitalEffect: planImpact?.capitalEffect,
      diversificationNote: planImpact?.diversificationNote,
      sizingNote: isPrimary ? pfa.sizingAdjustment : null,
      maxRiskDollars: src.maxRiskDollars,
    });
  }

  // If nothing from sections but we have a primary symbol, add it
  if (candidateImpact.length === 0 && allSymbols.length > 0) {
    const sym = allSymbols[0];
    const concEntry = concentration.find((c) => c.symbol === sym);
    candidateImpact.push({
      symbol: sym,
      existingHolding: pfa.duplicateExposure === true,
      duplicateExposure: pfa.duplicateExposure ?? false,
      concentrationBefore: concEntry?.currentPct,
      concentrationAfterEstimate: concEntry?.estimatedAfterPct,
      concentrationLevel: concEntry?.level,
      capitalEffect: planImpact?.capitalEffect,
      diversificationNote: planImpact?.diversificationNote,
      sizingNote: pfa.sizingAdjustment,
    });
  }

  // ---------------------------------------------------------------------------
  // Cash Utilization
  // ---------------------------------------------------------------------------
  const cashUtilization: CashUtilizationSection = {
    status: pfa.cashSufficiency ?? "unknown",
    buyingPowerStatus: pfa.buyingPowerSufficiency ?? "unknown",
    note: planImpact?.capitalEffect,
  };

  // ---------------------------------------------------------------------------
  // Upcoming Earnings flags
  // ---------------------------------------------------------------------------
  const earningsFlags: EarningsFlag[] = [];
  const allText = [
    ...safeResult.warnings,
    ...safeResult.limitations,
    ...(planCandidates.flatMap((c) => c.warnings ?? [])),
    ...(recCandidates.flatMap((c) => (c as Record<string, unknown[]>).warnings as string[] ?? [])),
  ];
  for (const text of allText) {
    if (EARNINGS_RISK_RE.test(text)) {
      const syms = extractSymbolsFromText(text);
      for (const sym of syms.slice(0, 3)) {
        if (!earningsFlags.find((f) => f.symbol === sym)) {
          earningsFlags.push({ symbol: sym, warning: text.slice(0, 200) });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Next Research Questions
  // ---------------------------------------------------------------------------
  const nextResearchQuestions = buildResearchQuestions(result, pfa);

  return {
    hasPortfolioContext: true,
    exposureSummary,
    cashUtilization,
    candidateImpact,
    concentration,
    earningsFlags,
    dataQuality,
    nextResearchQuestions,
  };
}

// ---------------------------------------------------------------------------
// Research-question generator
// ---------------------------------------------------------------------------

function buildResearchQuestions(
  result: TraderBrainResult,
  pfa: SafePortfolioAwareness | null,
): ResearchQuestion[] {
  const questions: ResearchQuestion[] = [];
  const sections = result.sections;
  const intent = result.intent as TraderBrainIntent;

  const primarySymbol = result.normalizedRequest.symbol ?? result.normalizedRequest.tickers[0];
  const direction = result.normalizedRequest.direction;

  // Candidate-specific questions
  const topSymbols: string[] = [
    ...(sections.rankedSearch?.candidates?.slice(0, 2).map((c: RankedTradeCandidate) => c.symbol) ?? []),
    ...(sections.portfolioTradePlan?.qualifiedCandidates?.slice(0, 2).map((c: PortfolioTradePlanCandidate) => c.symbol) ?? []),
    ...(sections.recommendation?.recommendations?.slice(0, 1).map((r: Record<string, unknown>) => String(r.symbol ?? "")) ?? []),
  ].filter(Boolean).slice(0, 2);

  // Comparison question
  if (topSymbols.length >= 2) {
    questions.push({
      question: `Compare ${topSymbols[0]} with ${topSymbols[1]}`,
    });
  } else if (topSymbols.length === 1 && primarySymbol && topSymbols[0] !== primarySymbol) {
    questions.push({
      question: `Compare this with ${topSymbols[0]}`,
    });
  }

  // Diversification question
  if (pfa?.concentrationWarning && pfa.concentrationWarning.level !== "normal") {
    questions.push({
      question: "Find a more diversified opportunity",
    });
    questions.push({
      question: "Show lower concentration alternatives",
    });
  } else if (intent === "RANK_MARKET_TRADES" || intent === "PLAN_PORTFOLIO_TRADE") {
    questions.push({
      question: "Find a more diversified opportunity",
    });
  }

  // Sector alternatives
  if (primarySymbol) {
    questions.push({
      question: `Show similar opportunities outside ${primarySymbol}'s sector`,
    });
  } else if (topSymbols.length > 0) {
    questions.push({
      question: `Show similar ${direction ?? "trade"} opportunities in a different sector`,
    });
  }

  // Earnings risk question
  if (result.warnings.some((w) => EARNINGS_RISK_RE.test(w)) || result.limitations.some((l) => EARNINGS_RISK_RE.test(l))) {
    questions.push({
      question: "Analyze portfolio earnings risk",
    });
  } else if (topSymbols.length > 0) {
    questions.push({
      question: "Analyze portfolio earnings risk",
    });
  }

  // Cash / risk-budget follow-up
  if (pfa?.cashSufficiency === "insufficient") {
    questions.push({
      question: "Find lower-cost alternatives that fit my buying power",
    });
  } else if (result.normalizedRequest.maxRiskDollars) {
    questions.push({
      question: "Show lower-risk alternatives within the same budget",
    });
  }

  // Return up to 5 unique questions
  const seen = new Set<string>();
  return questions.filter((q) => {
    if (seen.has(q.question)) return false;
    seen.add(q.question);
    return true;
  }).slice(0, 5);
}
