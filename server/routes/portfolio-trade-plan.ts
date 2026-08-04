// Portfolio-constrained trade planning (MCP plan_portfolio_trade).
//
// This module owns:
//   1. ROUTING — detecting portfolio-constrained asks (dollar risk, %-of-portfolio,
//      sector exclusion, own-holdings, income-from-holdings). Educational questions
//      ("how does a covered call work?") always return null.
//   2. ARG MAPPING — converting a classified goal into model-safe MCP args.
//      No account IDs, user IDs, connection IDs, broker tokens, or raw balances
//      ever reach this mapping function or the MCP call.
//   3. DEFENSIVE VALIDATION — raw MCP payload → strict typed shape.
//      Sensitive keys always dropped; feasibility boolean NEVER altered.
//   4. DETERMINISTIC PRESENTATION — headline + server-generated summary built
//      from the validated plan; used verbatim when the LLM is unavailable, and
//      the headline always wins over LLM output.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PortfolioTradePlanGoal {
  /** Type of portfolio constraint driving this ask. */
  kind:
    | "dollar_risk"
    | "percent_of_portfolio"
    | "sector_exclusion"
    | "require_existing_position"
    | "income_from_holdings";
  /** Max risk in dollars (dollar_risk). */
  maxRiskDollars?: number;
  /** Max risk as % of portfolio (percent_of_portfolio). */
  maxRiskPercent?: number;
  /** Sectors/themes to exclude (sector_exclusion). */
  excludeSectors?: string[];
  /** true when "from stocks I own" / "covered call" / "income from holdings". */
  requireExistingPosition?: boolean;
  /** Inferred objective: "income" for income/covered-call asks, else "growth". */
  objective?: "income" | "growth";
  /** Inferred direction when the user specifies one. */
  direction?: "bullish" | "bearish" | "neutral" | "either";
}

export interface PortfolioTradePlanConstraint {
  name: string;
  status: "met" | "partially_met" | "not_met" | "unknown";
  detail?: string;
}

export interface PortfolioTradePlanCandidate {
  rank: number;
  symbol: string;
  strategy?: string;
  direction?: string;
  instrument?: string;
  entryPrice?: number;
  stopPrice?: number;
  targetPrice?: number;
  maxRiskDollars?: number;
  maxRiskIsExact?: boolean;
  quantity?: number;
  rewardRisk?: number;
  whySelected: string[];
  warnings: string[];
}

export interface PortfolioTradePlanAlternative {
  symbol?: string;
  strategy?: string;
  whyFailed: string;
}

export interface PortfolioTradePlanImpact {
  concentrationEffect?: string;
  capitalEffect?: string;
  diversificationNote?: string;
}

export interface PortfolioTradePlanRisk {
  primaryRisk?: string;
  otherRisks?: string[];
}

export interface PortfolioTradePlan {
  feasibility: {
    feasible: boolean;
    reason?: string;
  };
  portfolioConstraints: PortfolioTradePlanConstraint[];
  qualifiedCandidates: PortfolioTradePlanCandidate[];
  whySelected?: string[];
  alternatives?: PortfolioTradePlanAlternative[];
  portfolioImpact?: PortfolioTradePlanImpact;
  risks?: PortfolioTradePlanRisk;
  nextSteps?: string[];
  generatedAt: string;
  warnings: string[];
}

export interface PortfolioTradePlanDeps {
  planPortfolioTrade: (args: PlanPortfolioTradeArgs) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Routing — classifier
// ---------------------------------------------------------------------------

// Patterns that identify an educational intent — these NEVER route to
// plan_portfolio_trade regardless of other keywords present.
const EDUCATIONAL_RE =
  /\b(how\s+does|how\s+do\s+i|what\s+is\s+(a\s+|an\s+|the\s+)?|what\s+are\s+|explain(\s+to\s+me)?|define(\s+a\s+|an\s+|the\s+)?|tell\s+me\s+about|teach\s+me|why\s+do\s+traders?|when\s+should\s+i\s+use)\b/i;

// Dollar-risk constraint: "risking less than $500", "max risk $200", "under $300 risk"
const DOLLAR_RISK_RE =
  /\b(?:risk(?:ing)?|max(?:imum)?\s+risk|under|less\s+than|no\s+more\s+than)\s*\$\s*(\d[\d,]*(?:\.\d+)?)\b|\$\s*(\d[\d,]*(?:\.\d+)?)\s+(?:risk|max(?:imum)?\s+risk)/i;

// Percent-of-portfolio: "5% of my portfolio", "less than 10% of portfolio", "under 3% of my account"
const PCT_PORTFOLIO_RE =
  /\b(\d+(?:\.\d+)?)\s*%\s+(?:of\s+(?:my\s+)?(?:portfolio|account|capital|budget|money)|portfolio|account\s+value)\b|\b(?:under|less\s+than|no\s+more\s+than)\s+(\d+(?:\.\d+)?)\s*%\s+(?:of\s+)?(?:my\s+)?(?:portfolio|account|capital)/i;

// Sector exclusion: "outside my semiconductor exposure", "avoid tech", "not in finance"
const SECTOR_EXCLUSION_RE =
  /\b(?:outside|avoid|excluding|not\s+in|away\s+from|reduce|limit)\s+(?:my\s+)?(?:\w+\s+)*(?:exposure|sector|holdings?|positions?|concentration)\b|\b(?:too\s+much|overweight)\s+(?:in\s+)?(?:\w+\s+)*(?:sector|space|exposure)\b/i;

// Known sectors / themes used with exclusion phrasing
const SECTOR_HINT_RE =
  /\b(semiconductor|semis?|tech(?:nology)?|finance|financial|banking|bank|energy|oil|healthcare|health|bio(?:tech)?|pharma|consumer|retail|industrial|utilities|real\s+estate|reit|defense|aerospace|software|cloud|ai|ev|electric\s+vehicle|crypto|cannabis)\b/i;

// Own-holdings / require existing position: "from stocks I own", "covered call from my holdings"
const OWN_HOLDINGS_RE =
  /\b(?:from\s+(?:stocks?|positions?|shares?|holdings?|names?)\s+i\s+(?:own|have|hold|already\s+own)|covered\s+call(?:s)?\s+(?:on|from|using)\s+(?:stocks?|shares?|holdings?|positions?)\s+(?:i\s+)?(?:own|have|hold)|use\s+(?:my\s+)?(?:existing|current)\s+(?:positions?|holdings?|stocks?))\b/i;

// Income from holdings: "generate income from my holdings", "income from my positions"
const INCOME_HOLDINGS_RE =
  /\b(?:generate|earn|collect|make|get)\s+(?:some\s+)?income\s+(?:from|on|off)\s+(?:my\s+)?(?:holdings?|positions?|stocks?|shares?|portfolio)\b|(?:income|premium)\s+(?:from|on|off)\s+(?:my\s+)?(?:holdings?|positions?|stocks?|shares?)\b/i;

/**
 * Returns a PortfolioTradePlanGoal if this question is a portfolio-constrained
 * trade ask, else null. Educational questions always return null.
 *
 * Trigger examples (non-exhaustive):
 *   "Find a trade risking less than $500"
 *   "Find a trade using less than 5% of my portfolio"
 *   "Find something outside my semiconductor exposure"
 *   "Find a covered call from stocks I own"
 *   "Generate income from my holdings"
 */
export function classifyPortfolioTradePlan(
  question: string,
  tickers: string[] = [],
): PortfolioTradePlanGoal | null {
  if (!question || typeof question !== "string") return null;
  const lower = question.toLowerCase().trim();
  // Educational questions never route here.
  if (EDUCATIONAL_RE.test(lower)) return null;
  // Questions about a specific ticker stay on the recommend_trade_strategy path.
  if (tickers.length > 0) return null;

  // --- Income from holdings ---
  if (INCOME_HOLDINGS_RE.test(lower)) {
    return {
      kind: "income_from_holdings",
      requireExistingPosition: true,
      objective: "income",
    };
  }

  // --- Own-holdings (covered call / require existing position) ---
  if (OWN_HOLDINGS_RE.test(lower)) {
    const incomeHint = /\b(income|premium|yield|cash\s+flow)\b/i.test(lower);
    return {
      kind: "require_existing_position",
      requireExistingPosition: true,
      objective: incomeHint ? "income" : "growth",
    };
  }

  // --- Sector exclusion ---
  if (SECTOR_EXCLUSION_RE.test(lower) || (SECTOR_HINT_RE.test(lower) && /\b(outside|avoid|exclude|not\s+in)\b/i.test(lower))) {
    const sectors: string[] = [];
    let m: RegExpExecArray | null;
    const re = new RegExp(SECTOR_HINT_RE.source, "gi");
    while ((m = re.exec(lower)) !== null) {
      sectors.push(m[1].toLowerCase());
    }
    return {
      kind: "sector_exclusion",
      excludeSectors: sectors.length > 0 ? sectors : undefined,
    };
  }

  // --- Dollar risk ---
  const dollarMatch = DOLLAR_RISK_RE.exec(lower);
  if (dollarMatch) {
    const raw = (dollarMatch[1] ?? dollarMatch[2] ?? "0").replace(/,/g, "");
    const maxRiskDollars = parseFloat(raw);
    if (Number.isFinite(maxRiskDollars) && maxRiskDollars > 0) {
      return {
        kind: "dollar_risk",
        maxRiskDollars: Math.min(maxRiskDollars, 100_000),
      };
    }
  }

  // --- Percent of portfolio ---
  const pctMatch = PCT_PORTFOLIO_RE.exec(lower);
  if (pctMatch) {
    const raw = pctMatch[1] ?? pctMatch[2] ?? "0";
    const pct = parseFloat(raw);
    if (Number.isFinite(pct) && pct > 0 && pct <= 100) {
      return {
        kind: "percent_of_portfolio",
        maxRiskPercent: pct,
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Arg mapping — model-safe args only
// ---------------------------------------------------------------------------

export interface PlanPortfolioTradeArgs {
  direction?: "bullish" | "bearish" | "neutral" | "either";
  instrumentPreference?: "stock" | "options" | "either";
  objective?: "growth" | "income" | "capital_preservation" | "hedging" | "speculative";
  requestedStrategy?: string;
  maxRiskDollars?: number;
  maxRiskPercent?: number;
  excludeSectors?: string[];
  requireExistingPosition?: boolean;
  numberOfIdeas?: number;
  /** Short-lived OPAQUE backend-minted context token — never a broker OAuth token. */
  portfolioContextToken?: string;
  /** Short-lived OPAQUE backend-minted options context token. */
  optionsContextToken?: string;
}

/**
 * Map a PortfolioTradePlanGoal onto model-safe MCP args ONLY.
 * NEVER: symbol pre-selection, userId, accountId, connectionId, broker tokens,
 * API keys, raw balances, or any credential.
 */
export function portfolioGoalToMcpArgs(goal: PortfolioTradePlanGoal): PlanPortfolioTradeArgs {
  const args: PlanPortfolioTradeArgs = {};
  if (goal.direction) args.direction = goal.direction;
  if (goal.objective) args.objective = goal.objective;
  if (typeof goal.maxRiskDollars === "number" && goal.maxRiskDollars > 0) {
    args.maxRiskDollars = Math.min(goal.maxRiskDollars, 100_000);
  }
  if (typeof goal.maxRiskPercent === "number" && goal.maxRiskPercent > 0 && goal.maxRiskPercent <= 100) {
    args.maxRiskPercent = goal.maxRiskPercent;
  }
  if (goal.excludeSectors && goal.excludeSectors.length > 0) {
    args.excludeSectors = goal.excludeSectors.slice(0, 10).map((s) => String(s).slice(0, 60));
  }
  if (goal.requireExistingPosition) args.requireExistingPosition = true;
  // Instrument preference driven by objective
  if (goal.objective === "income") args.instrumentPreference = "options";
  args.numberOfIdeas = 3;
  // NEVER: portfolioContextToken, optionsContextToken — those are added by the
  // orchestrator, never by this mapping function.
  return args;
}

// ---------------------------------------------------------------------------
// Defensive validation
// ---------------------------------------------------------------------------

/** Keys that must NEVER pass through wherever they appear. */
const SENSITIVE_KEY_RE =
  /token|secret|credential|password|apikey|api_key|authorization|cookie|session|userid|user_id|accountid|account_id|connectionid|connection_id/i;

function str(v: unknown, max = 400): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s.slice(0, max) : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function strArray(v: unknown, maxItems = 12, maxLen = 400): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => typeof x === "string" && x.trim())
    .slice(0, maxItems)
    .map((x) => String(x).trim().slice(0, maxLen));
}

function sanitizeConstraint(raw: unknown): PortfolioTradePlanConstraint | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = str(o.name ?? o.constraint ?? o.label, 120);
  if (!name) return null;
  const rawStatus = str(o.status, 20);
  const status: PortfolioTradePlanConstraint["status"] =
    rawStatus === "met" || rawStatus === "partially_met" || rawStatus === "not_met"
      ? rawStatus
      : "unknown";
  return {
    name,
    status,
    ...(str(o.detail ?? o.description, 280) ? { detail: str(o.detail ?? o.description, 280) } : {}),
  };
}

function sanitizeCandidate(raw: unknown, index: number): PortfolioTradePlanCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const symbol = (() => {
    const s = str(o.symbol ?? o.ticker, 12)?.toUpperCase();
    return s && /^[A-Z][A-Z0-9.\-\/]{0,9}$/.test(s) ? s : undefined;
  })();
  if (!symbol) return null;
  const dataQuality = str(o.dataQuality ?? o.data_quality, 40);
  const liveish =
    typeof dataQuality === "string" &&
    /\b(live|real)\b/i.test(dataQuality) &&
    !/estimat|partial|mock|stale/i.test(dataQuality);
  const maxRisk = num(o.maxRiskDollars ?? o.maxRisk ?? o.maxLoss);
  return {
    rank: (() => { const n = num(o.rank); return n != null && n >= 1 ? Math.floor(n) : index + 1; })(),
    symbol,
    ...(str(o.strategy) ? { strategy: str(o.strategy) } : {}),
    ...(str(o.direction) ? { direction: str(o.direction) } : {}),
    ...(str(o.instrument ?? o.instrumentType) ? { instrument: str(o.instrument ?? o.instrumentType) } : {}),
    ...(num(o.entryPrice) != null ? { entryPrice: num(o.entryPrice) } : {}),
    ...(num(o.stopPrice) != null ? { stopPrice: num(o.stopPrice) } : {}),
    ...(num(o.targetPrice) != null ? { targetPrice: num(o.targetPrice) } : {}),
    ...(maxRisk != null ? { maxRiskDollars: maxRisk, maxRiskIsExact: liveish } : {}),
    ...(num(o.quantity) != null ? { quantity: Math.max(1, Math.floor(num(o.quantity)!)) } : {}),
    ...(num(o.rewardRisk ?? o.rewardRiskRatio ?? o.rr) != null ? { rewardRisk: num(o.rewardRisk ?? o.rewardRiskRatio ?? o.rr) } : {}),
    whySelected: strArray(o.whySelected ?? o.reasons ?? o.rankReasons),
    warnings: strArray(o.warnings),
  };
}

function sanitizeAlternative(raw: unknown): PortfolioTradePlanAlternative | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const whyFailed = str(o.whyFailed ?? o.reason ?? o.rejection, 280);
  if (!whyFailed) return null;
  // Validate symbol with the same regex used for candidates — invalid symbols
  // are silently dropped while the alternative entry (whyFailed) is kept.
  const rawSym = str(o.symbol ?? o.ticker, 12)?.toUpperCase();
  const validSym = rawSym && /^[A-Z][A-Z0-9.\-\/]{0,9}$/.test(rawSym) ? rawSym : undefined;
  return {
    ...(validSym ? { symbol: validSym } : {}),
    ...(str(o.strategy) ? { strategy: str(o.strategy) } : {}),
    whyFailed,
  };
}

function sanitizeImpact(raw: unknown): PortfolioTradePlanImpact | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const concentrationEffect = str(o.concentrationEffect ?? o.concentration, 200);
  const capitalEffect = str(o.capitalEffect ?? o.capital, 200);
  const diversificationNote = str(o.diversificationNote ?? o.diversification, 200);
  if (!concentrationEffect && !capitalEffect && !diversificationNote) return undefined;
  return {
    ...(concentrationEffect ? { concentrationEffect } : {}),
    ...(capitalEffect ? { capitalEffect } : {}),
    ...(diversificationNote ? { diversificationNote } : {}),
  };
}

function sanitizeRisks(raw: unknown): PortfolioTradePlanRisk | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const primaryRisk = str(o.primaryRisk ?? o.primary, 280);
  const otherRisks = strArray(o.otherRisks ?? o.risks ?? o.additionalRisks, 6, 200);
  if (!primaryRisk && otherRisks.length === 0) return undefined;
  return {
    ...(primaryRisk ? { primaryRisk } : {}),
    ...(otherRisks.length > 0 ? { otherRisks } : {}),
  };
}

function sanitizeFeasibility(raw: unknown): PortfolioTradePlan["feasibility"] {
  // feasibility.feasible is NEVER altered — it is the authoritative verdict.
  const fallback: PortfolioTradePlan["feasibility"] = { feasible: false, reason: "Feasibility not determined." };
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;
  if (typeof o.feasible !== "boolean") return fallback;
  return {
    feasible: o.feasible,
    ...(str(o.reason, 280) ? { reason: str(o.reason, 280) } : {}),
  };
}

/**
 * Defensive normalization of the raw MCP payload. Throws on invalid shape.
 * Sensitive keys dropped; feasibility.feasible NEVER altered.
 */
export function validatePortfolioTradePlan(raw: unknown, _goal?: PortfolioTradePlanGoal): PortfolioTradePlan {
  // Unwrap MCP content blocks: { content: [{ type: "text", text: "..." }] }
  let payload: unknown = raw;
  if (payload && typeof payload === "object" && Array.isArray((payload as any).content)) {
    const text = (payload as any).content.find(
      (c: any) => c?.type === "text" && typeof c.text === "string",
    )?.text;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error("plan_portfolio_trade returned non-JSON content");
      }
    }
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("plan_portfolio_trade returned an invalid payload");
  }
  const o = payload as Record<string, unknown>;
  // Drop all sensitive keys from the top-level object silently.
  for (const key of Object.keys(o)) {
    if (SENSITIVE_KEY_RE.test(key)) delete o[key];
  }
  if (!("feasibility" in o)) {
    throw new Error("plan_portfolio_trade payload missing feasibility field");
  }
  const qualifiedCandidates = (Array.isArray(o.qualifiedCandidates) ? o.qualifiedCandidates : [])
    .slice(0, 10)
    .map((c, i) => sanitizeCandidate(c, i))
    .filter((c): c is PortfolioTradePlanCandidate => c !== null);
  const portfolioConstraints = (Array.isArray(o.portfolioConstraints) ? o.portfolioConstraints : [])
    .slice(0, 20)
    .map(sanitizeConstraint)
    .filter((c): c is PortfolioTradePlanConstraint => c !== null);
  const alternatives = (Array.isArray(o.alternatives ?? o.whyAlternativesFailed) ? (o.alternatives ?? o.whyAlternativesFailed) : [])
    .slice(0, 10)
    .map(sanitizeAlternative)
    .filter((a): a is PortfolioTradePlanAlternative => a !== null);
  return {
    feasibility: sanitizeFeasibility(o.feasibility),
    portfolioConstraints,
    qualifiedCandidates,
    ...(strArray(o.whySelected ?? o.selectionReasons).length > 0 ? { whySelected: strArray(o.whySelected ?? o.selectionReasons, 6, 280) } : {}),
    ...(alternatives.length > 0 ? { alternatives } : {}),
    ...(sanitizeImpact(o.portfolioImpact ?? o.impact) ? { portfolioImpact: sanitizeImpact(o.portfolioImpact ?? o.impact) } : {}),
    ...(sanitizeRisks(o.risks ?? o.riskAssessment) ? { risks: sanitizeRisks(o.risks ?? o.riskAssessment) } : {}),
    ...(strArray(o.nextSteps, 8, 200).length > 0 ? { nextSteps: strArray(o.nextSteps, 8, 200) } : {}),
    generatedAt: str(o.generatedAt, 40) ?? new Date().toISOString(),
    warnings: strArray(o.warnings),
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** One MCP call per request; validated defensively. Throws on failure. */
export async function runPortfolioTradePlan(
  goal: PortfolioTradePlanGoal,
  deps: PortfolioTradePlanDeps,
): Promise<PortfolioTradePlan> {
  const args = portfolioGoalToMcpArgs(goal);
  // portfolioContextToken and optionsContextToken are injected by the caller
  // (ask.ts) after arg mapping — they are never inside portfolioGoalToMcpArgs.
  const raw = await deps.planPortfolioTrade(args);
  return validatePortfolioTradePlan(raw, goal);
}

// ---------------------------------------------------------------------------
// Deterministic presentation
// ---------------------------------------------------------------------------

export interface PortfolioTradePlanAnswer {
  headline: string;
  answer: string;
  keyPoints: string[];
  riskNote: string;
  confidence: "low" | "medium" | "high";
}

const WORD_NUMBERS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
function wordCount(n: number): string {
  return n >= 0 && n <= 10 ? WORD_NUMBERS[n] : String(n);
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Deterministic headline. The LLM may never override this. */
function portfolioTradePlanHeadline(plan: PortfolioTradePlan, goal: PortfolioTradePlanGoal): string {
  if (!plan.feasibility.feasible) {
    const reason = plan.feasibility.reason ?? "the portfolio constraints could not be met";
    return `Portfolio-constrained plan: not feasible — ${reason.charAt(0).toLowerCase() + reason.slice(1)}.`;
  }
  const q = plan.qualifiedCandidates.length;
  if (q === 0) {
    return "Portfolio constraints were evaluated, but no candidates currently qualify.";
  }
  if (goal.kind === "dollar_risk" && typeof goal.maxRiskDollars === "number") {
    return `${cap(wordCount(q))} candidate${q === 1 ? "" : "s"} found fitting a $${goal.maxRiskDollars.toLocaleString("en-US")} maximum-risk budget.`;
  }
  if (goal.kind === "percent_of_portfolio" && typeof goal.maxRiskPercent === "number") {
    return `${cap(wordCount(q))} candidate${q === 1 ? "" : "s"} found fitting within a ${goal.maxRiskPercent}% portfolio-risk limit.`;
  }
  if (goal.kind === "sector_exclusion") {
    const sectors = goal.excludeSectors?.join(", ");
    return `${cap(wordCount(q))} candidate${q === 1 ? "" : "s"} found${sectors ? ` outside ${sectors} exposure` : " matching the sector exclusion"}.`;
  }
  if (goal.kind === "income_from_holdings" || goal.kind === "require_existing_position") {
    return `${cap(wordCount(q))} income candidate${q === 1 ? "" : "s"} identified from your existing holdings.`;
  }
  return `${cap(wordCount(q))} portfolio-constrained candidate${q === 1 ? "" : "s"} identified.`;
}

/**
 * Server-generated deterministic summary — used verbatim when the LLM is
 * unavailable and establishes the count contract the LLM must agree with.
 */
export function buildPortfolioTradePlanAnswer(
  plan: PortfolioTradePlan,
  goal: PortfolioTradePlanGoal,
): PortfolioTradePlanAnswer {
  const lines: string[] = [];

  // Feasibility
  lines.push(
    plan.feasibility.feasible
      ? `Feasibility: YES — ${plan.feasibility.reason ?? "the portfolio constraints were met."}`
      : `Feasibility: NO — ${plan.feasibility.reason ?? "the portfolio constraints could not be met."}`,
  );

  // Constraints
  if (plan.portfolioConstraints.length > 0) {
    const constraintLines = plan.portfolioConstraints.map(
      (c) => `- ${c.name}: ${c.status.replace(/_/g, " ")}${c.detail ? ` (${c.detail})` : ""}`,
    );
    lines.push("Portfolio constraints:\n" + constraintLines.join("\n"));
  }

  // Candidates
  if (plan.qualifiedCandidates.length > 0) {
    lines.push("Qualified candidates (deterministic — order preserved):");
    for (const c of plan.qualifiedCandidates) {
      const bits = [
        `${c.rank}. ${c.symbol}`,
        c.strategy,
        c.direction,
        c.entryPrice != null ? `entry $${c.entryPrice}` : undefined,
        c.stopPrice != null ? `stop $${c.stopPrice}` : undefined,
        c.maxRiskDollars != null
          ? `${c.maxRiskIsExact ? "max risk" : "est. max risk"} $${c.maxRiskDollars.toLocaleString("en-US")}`
          : undefined,
        c.rewardRisk != null ? `R/R ${c.rewardRisk}` : undefined,
      ].filter(Boolean);
      lines.push(`- ${bits.join(" — ")}`);
    }
  }

  // Why selected
  if (plan.whySelected && plan.whySelected.length > 0) {
    lines.push("Why selected: " + plan.whySelected.join("; "));
  }

  // Alternatives / why others failed
  if (plan.alternatives && plan.alternatives.length > 0) {
    lines.push("Why alternatives failed:");
    for (const a of plan.alternatives) {
      const prefix = a.symbol ? `${a.symbol}${a.strategy ? ` (${a.strategy})` : ""}` : (a.strategy ?? "Alternative");
      lines.push(`- ${prefix}: ${a.whyFailed}`);
    }
  }

  // Portfolio impact
  if (plan.portfolioImpact) {
    const impactParts = [
      plan.portfolioImpact.concentrationEffect,
      plan.portfolioImpact.capitalEffect,
      plan.portfolioImpact.diversificationNote,
    ].filter(Boolean);
    if (impactParts.length > 0) lines.push("Portfolio impact: " + impactParts.join(" "));
  }

  // Risks
  if (plan.risks?.primaryRisk) {
    lines.push("Primary risk: " + plan.risks.primaryRisk);
  }
  if (plan.risks?.otherRisks && plan.risks.otherRisks.length > 0) {
    lines.push("Additional risks: " + plan.risks.otherRisks.join("; "));
  }

  // Next steps
  if (plan.nextSteps && plan.nextSteps.length > 0) {
    lines.push("Suggested next steps:");
    for (const step of plan.nextSteps) {
      lines.push(`- ${step}`);
    }
  }

  if (plan.warnings.length > 0) {
    lines.push("Warnings: " + plan.warnings.join(" "));
  }

  // Key points
  const keyPoints: string[] = [
    plan.feasibility.feasible ? "Plan is feasible" : "Plan is not feasible",
    `Qualified candidates: ${plan.qualifiedCandidates.length}`,
    ...(plan.portfolioConstraints.filter((c) => c.status === "not_met").length > 0
      ? [`Constraints not met: ${plan.portfolioConstraints.filter((c) => c.status === "not_met").map((c) => c.name).join(", ")}`]
      : []),
    ...(plan.risks?.primaryRisk ? [`Primary risk: ${plan.risks.primaryRisk.slice(0, 80)}`] : []),
    ...(plan.warnings.length > 0 ? [`${plan.warnings.length} warning${plan.warnings.length === 1 ? "" : "s"}`] : []),
  ].slice(0, 5);

  const confidence: "low" | "medium" | "high" =
    plan.qualifiedCandidates.length > 0 && plan.feasibility.feasible
      ? "medium"
      : plan.feasibility.feasible && plan.qualifiedCandidates.length === 0
        ? "low"
        : "low";

  return {
    headline: portfolioTradePlanHeadline(plan, goal),
    answer: lines.join("\n"),
    keyPoints,
    riskNote:
      "Deterministic portfolio-constrained research output — not investment advice. Nothing here places or prepares an order automatically.",
    confidence,
  };
}

/** Static, safe suggestions for the portfolio-trade-plan response. */
export function portfolioTradePlanSuggestions(plan: PortfolioTradePlan): Array<{ label: string; href: string }> {
  const out: Array<{ label: string; href: string }> = [];
  const first = plan.qualifiedCandidates[0];
  if (first) {
    out.push({
      label: `Analyze ${first.symbol}`,
      href: `/ask?q=${encodeURIComponent(`Analyze ${first.symbol}`)}`,
    });
  }
  out.push({ label: "Open Scanner", href: "/scanner" });
  out.push({ label: "View Portfolio", href: "/portfolio" });
  if (plan.qualifiedCandidates.length > 0) {
    out.push({ label: "Open Trade Builder", href: "/trade-finder" });
  }
  return out.slice(0, 4);
}
