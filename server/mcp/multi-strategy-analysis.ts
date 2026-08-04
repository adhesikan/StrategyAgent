// Deterministic multi-strategy symbol analysis for Ask AI ("Analyze MU").
//
// Upgrades the generic stock-analysis ask from VCP-only to: all eligible
// targeted scanner strategies for the symbol → deterministic comparison →
// trade-candidate qualification → structured multiStrategyAnalysis payload.
// The LLM only EXPLAINS this payload; it never invents strategy matches,
// scores, triggers, or verdicts.
//
// Explicit VCP requests ("Analyze MU using VCP", "Is CRDO pivot-ready?")
// stay on the existing detailed VCP path (analysis-scan.ts) — unchanged.
//
// Resilience rules (spec):
// - bounded concurrency for scan_strategy calls (never uncontrolled fan-out)
// - per-tool timeout; one strategy failure never fails the whole analysis
// - strategy registry metadata is cached
// - never rerun a full-market scan for a single-symbol analysis
// - build_trade_candidate calls are capped

import { isStockAnalysisAsk } from "./analysis-scan";
import { scrubUntrusted, type McpSetup, type McpCandidate } from "../routes/opportunity-search-mcp";

// ---------------------------------------------------------------------------
// Registry metadata (authoritative — server/routes/internal-scanner.ts)
// ---------------------------------------------------------------------------

export interface StrategyMeta {
  id: string;
  displayName: string;
  supportedTimeframes: string[];
  targetedScan: boolean;
  enabled: boolean;
}

const REGISTRY_TTL_MS = 5 * 60 * 1000;
let registryCache: { at: number; data: StrategyMeta[] } | null = null;

/** Loads the authoritative internal strategy registry with a short TTL cache. */
export async function getCachedStrategyRegistry(
  loader?: () => Promise<StrategyMeta[]>,
  now: number = Date.now(),
): Promise<StrategyMeta[]> {
  if (registryCache && now - registryCache.at < REGISTRY_TTL_MS) return registryCache.data;
  const load =
    loader ??
    (async () => {
      const { listInternalStrategies } = await import("../routes/internal-scanner");
      return listInternalStrategies();
    });
  const data = await load();
  registryCache = { at: now, data };
  return data;
}

/** Test hook — clears the registry cache. */
export function _clearRegistryCache(): void {
  registryCache = null;
}

// ---------------------------------------------------------------------------
// Intent split (deterministic, before OpenAI)
// ---------------------------------------------------------------------------

export type AnalysisIntentKind = "GENERIC_MULTI_STRATEGY" | "EXPLICIT_VCP" | "EXPLICIT_STRATEGY";

export interface AnalysisIntent {
  kind: AnalysisIntentKind;
  /** Resolved registry strategy id for EXPLICIT_STRATEGY. */
  strategyId?: string;
  strategyDisplayName?: string;
  /** Raw strategy phrase the user named but could not be resolved. */
  unresolvedStrategy?: string;
}

// Explicit-VCP vocabulary: any of these words makes an analysis ask VCP-specific.
const VCP_HINT_RE = /\bvcp\b|\bpivot[- ]?ready\b|\bpivot\b|\bcontractions?\b/;

// "using X" / "with X" / "run X on SYM" / "check SYM for X" strategy phrases.
const EXPLICIT_STRATEGY_RES: RegExp[] = [
  /\b(?:using|with|via)\s+(?:the\s+)?([a-z][a-z0-9 _-]{2,40}?)(?:\s+(?:strategy|scan|setup))?\s*$/,
  /\brun\s+(?:an?\s+)?([a-z][a-z0-9 _-]{2,40}?)\s+(?:scan\s+|strategy\s+)?on\s+\$?[a-z]{1,5}\b/,
  /\bcheck\s+\$?[a-z]{1,5}\s+for\s+(?:an?\s+)?([a-z][a-z0-9 _-]{2,40}?)(?:\s+(?:setup|strategy|scan))?\s*$/,
];

function normPhrase(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Classifies an analysis ask deterministically. Returns null when the
 * question is not a stock-analysis ask at all (caller keeps existing flows).
 * `registry` supplies strategy names/aliases for explicit-strategy detection.
 */
export function classifyAnalysisIntent(question: string, registry: StrategyMeta[]): AnalysisIntent | null {
  const lower = String(question ?? "").toLowerCase();

  // A strategy-name mention only routes when the question is actually an
  // analysis-style ask ("analyze/evaluate/check/run/scan ..."). A news or
  // general question that merely names a strategy must keep its existing
  // flow — never hijacked into a scan.
  const analysisVerb = isStockAnalysisAsk(question) || /\b(check|run|scan)\b/.test(lower);

  // Direct strategy mention by display name or id anywhere in the question
  // ("Analyze MU using Volume Surge", "Check NVDA for Power Breakout").
  const qNorm = ` ${normPhrase(lower)} `;
  let mentioned: StrategyMeta | null = null;
  if (analysisVerb) {
    for (const meta of registry) {
      const names = [meta.displayName, meta.id.replace(/_/g, " ")];
      if (names.some((n) => n && qNorm.includes(` ${normPhrase(n)} `))) {
        mentioned = meta;
        break;
      }
    }
  }
  if (mentioned && mentioned.id.toUpperCase() !== "VCP") {
    return { kind: "EXPLICIT_STRATEGY", strategyId: mentioned.id, strategyDisplayName: mentioned.displayName };
  }

  const isVcp = VCP_HINT_RE.test(lower) || (mentioned && mentioned.id.toUpperCase() === "VCP");
  const isAnalysis =
    isStockAnalysisAsk(question) ||
    /\bscan\b/.test(lower) ||
    /\bshow\b/.test(lower) ||
    /\bpivot[- ]?ready\b/.test(lower) ||
    /\bis\s+\$?[a-z]{1,5}\b/.test(lower);
  if (isVcp && isAnalysis) return { kind: "EXPLICIT_VCP" };

  // "using/with/run <name>" phrase that names something we cannot resolve →
  // surface supported strategies safely instead of guessing.
  if (isStockAnalysisAsk(question)) {
    for (const re of EXPLICIT_STRATEGY_RES) {
      const m = lower.match(re);
      if (m?.[1]) {
        const phrase = normPhrase(m[1]);
        // Skip filler captures ("technical analysis", timeframes, etc.)
        if (!phrase || /^(a|an|the|technical|analysis|chart|charts|daily|weekly)$/.test(phrase)) continue;
        const hit = registry.find(
          (s) => normPhrase(s.displayName) === phrase || normPhrase(s.id.replace(/_/g, " ")) === phrase,
        );
        if (hit) {
          return hit.id.toUpperCase() === "VCP"
            ? { kind: "EXPLICIT_VCP" }
            : { kind: "EXPLICIT_STRATEGY", strategyId: hit.id, strategyDisplayName: hit.displayName };
        }
        if (phrase === "vcp") return { kind: "EXPLICIT_VCP" };
        return { kind: "EXPLICIT_STRATEGY", unresolvedStrategy: m[1].trim() };
      }
    }
    return { kind: "GENERIC_MULTI_STRATEGY" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Structured response contract (§4) — additive, all-optional for the client
// ---------------------------------------------------------------------------

export type OverallVerdict = "TRADE_CANDIDATE" | "WATCH" | "NO_TRADE" | "INSUFFICIENT_DATA";

/**
 * Structured candidate-qualification result derived server-side from the raw
 * MCP build_trade_candidate response. Additive — the raw `candidate` is kept
 * for backward compatibility. Absent entirely when the entry was never
 * evaluated (beyond the bounded candidate-build cap).
 */
export interface CandidateCheck {
  status: "QUALIFIED" | "WATCH" | "NO_TRADE" | "UNAVAILABLE";
  verdict?: string | null;
  reason?: string | null;
  warnings?: string[];
  riskSummary?: Record<string, unknown> | null;
}

export interface MultiStrategySetupEntry {
  setup: McpSetup;
  candidate?: McpCandidate | null;
  candidateCheck?: CandidateCheck;
}

export interface MultiStrategyAnalysis {
  symbol: string;
  generatedAt?: string;
  timeframe?: string;
  strategiesChecked: number;
  strategiesMatched: number;
  strategiesFailed: number;
  overallVerdict: OverallVerdict;
  primarySetup?: (MultiStrategySetupEntry & { selectionReasons: string[] }) | null;
  supportingSetups: MultiStrategySetupEntry[];
  noMatchStrategies?: string[];
  failedStrategies?: Array<{ strategy: string; safeErrorCode: string }>;
  marketContext?: {
    price?: number | null;
    trend?: string | null;
    marketRegime?: string | null;
    earningsRisk?: string | null;
  };
  dataQuality: {
    source: string;
    realMarketData: boolean;
    fresh: boolean | null;
    complete: boolean;
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface MultiStrategyDeps {
  scanStrategy: (symbol: string, strategy: string, timeframe?: string) => Promise<unknown>;
  buildTradeCandidate: (symbol: string, strategy: string) => Promise<unknown>;
  listStrategies?: () => Promise<StrategyMeta[]>;
  timeframe?: string;
  /** Bounded scan concurrency (spec: 3–4). */
  concurrency?: number;
  /** Per-tool timeout in ms. */
  toolTimeoutMs?: number;
  now?: Date;
}

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_TOOL_TIMEOUT_MS = 12_000;
const MAX_CANDIDATE_BUILDS = 3; // primary + up to two comparison setups
const FRESHNESS_MS = 10 * 24 * 60 * 60 * 1000; // mirrors stored-opportunity expiry

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      const err: any = new Error("tool timeout");
      err.code = "TIMEOUT";
      reject(err);
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Bounded-concurrency map preserving input order. */
export async function mapBounded<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

function isValidSetup(s: unknown): s is McpSetup {
  return !!s && typeof s === "object" && typeof (s as any).symbol === "string" && !!(s as any).symbol && typeof (s as any).strategy === "string";
}

/**
 * Classifies a failed scan_strategy call into its specific first-failing
 * component (diagnostic logging only — never changes control flow).
 */
export function classifyScanFailure(code: unknown, message: string): string {
  const m = message.toLowerCase();
  if (/-32602|invalid arguments for tool|invalid option: expected/.test(m)) return "MCP_SCHEMA_VALIDATION";
  if (/unknown strategy/.test(m)) return "STRATEGY_ALIAS_RESOLUTION";
  if (/http 429|rate limit|too many requests/.test(m)) return "PROVIDER_RATE_LIMITED";
  if (/history|candles|ohlc/.test(m)) return "MARKET_HISTORY";
  if (/scanner\/setup/.test(m)) return "INTERNAL_SCANNER_SETUP";
  if (/scanner\/opportunit/.test(m)) return "INTERNAL_SCANNER_OPPORTUNITIES";
  if (/provider request failed|provider/.test(m)) return "PROVIDER_SELECTION";
  if (code === "UNSUPPORTED_STRATEGY_MAPPING") return "UNSUPPORTED_STRATEGY_MAPPING";
  if (code === "UNSUPPORTED_TIMEFRAME") return "UNSUPPORTED_TIMEFRAME";
  if (code === "MCP_TIMEOUT") return "MCP_TIMEOUT";
  if (code === "MCP_UNAVAILABLE") return "MCP_UNAVAILABLE";
  return "UNCLASSIFIED_TOOL_ERROR";
}

/** Extracts a setup from a tolerant scan_strategy response shape. */
function extractSetup(raw: unknown): McpSetup | null {
  const r: any = raw;
  if (!r || typeof r !== "object") return null;
  if (r.setup === null) return null; // explicit no-setup
  if (isValidSetup(r.setup)) return r.setup;
  if (Array.isArray(r.setups)) return r.setups.find(isValidSetup) ?? null;
  if (Array.isArray(r.results)) return r.results.find(isValidSetup) ?? null;
  if (isValidSetup(r)) return r;
  return null;
}

type QualifiedVerdict = "STOCK" | "LIVE_OPTIONS" | "ESTIMATED_OPTIONS";

function candidateVerdict(c: McpCandidate | null | undefined): string | null {
  const v = String(c?.verdict ?? "").toUpperCase();
  return v || null;
}

function isQualifiedVerdict(v: string | null): v is QualifiedVerdict {
  return v === "STOCK" || v === "LIVE_OPTIONS" || v === "ESTIMATED_OPTIONS";
}

/**
 * Derives the structured candidateCheck from a raw candidate result.
 * - `undefined` (never evaluated — beyond the bounded cap) → undefined
 * - `null` (build failed/timed out/unparseable) → UNAVAILABLE
 * - qualified verdict → QUALIFIED; NO_TRADE → NO_TRADE with the MCP-supplied
 *   rejection reason; any other verdict → WATCH.
 * Never fabricates a reason — only relays MCP-supplied text.
 */
export function deriveCandidateCheck(c: McpCandidate | null | undefined): CandidateCheck | undefined {
  if (c === undefined) return undefined;
  if (c === null) {
    return { status: "UNAVAILABLE", verdict: null, reason: "Candidate qualification unavailable" };
  }
  const v = candidateVerdict(c);
  const raw = c as Record<string, unknown>;
  const reasons = [
    ...(Array.isArray(c.noTradeReasons) ? c.noTradeReasons : []),
    ...(Array.isArray(raw.reasons) ? (raw.reasons as unknown[]) : []),
  ]
    .map((r) => String(r))
    .filter(Boolean);
  const warnings = (Array.isArray(raw.warnings) ? (raw.warnings as unknown[]) : [])
    .map((w) => String(w))
    .filter(Boolean)
    .slice(0, 5);
  const riskSummary =
    raw.risk && typeof raw.risk === "object" ? (raw.risk as Record<string, unknown>) : null;
  const base: CandidateCheck = {
    status: "WATCH",
    verdict: v,
    reason: reasons[0] ?? null,
    ...(warnings.length ? { warnings } : {}),
    riskSummary,
  };
  if (isQualifiedVerdict(v)) return { ...base, status: "QUALIFIED" };
  if (v === "NO_TRADE") return { ...base, status: "NO_TRADE" };
  if (!v) return { ...base, status: "UNAVAILABLE", reason: base.reason ?? "Candidate qualification unavailable" };
  return base;
}

function statusRank(status: string | null | undefined): number {
  const s = String(status ?? "").toLowerCase();
  if (s === "triggered" || s === "breakout") return 3;
  if (s === "ready") return 2;
  if (s === "forming") return 1;
  return 0;
}

function hasValidTrigger(s: McpSetup): boolean {
  return typeof s.trigger?.price === "number" && Number.isFinite(s.trigger.price);
}

/** fresh=2, unknown=1, stale=0 */
function freshnessRank(s: McpSetup, now: Date): number {
  if (!s.detectedAt) return 1;
  const t = Date.parse(s.detectedAt);
  if (!Number.isFinite(t)) return 1;
  return now.getTime() - t <= FRESHNESS_MS ? 2 : 0;
}

function isMockSource(source: string | undefined): boolean {
  return /mock|synthetic|sample|fake/i.test(String(source ?? ""));
}

/**
 * Deterministic setup comparison per spec §3.8. NEVER compares raw scores
 * across strategies (b→d then source ranking; registry order breaks ties).
 */
export function compareSetups(a: McpSetup, b: McpSetup, now: Date): number {
  const status = statusRank(b.status) - statusRank(a.status);
  if (status !== 0) return status;
  const trig = Number(hasValidTrigger(b)) - Number(hasValidTrigger(a));
  if (trig !== 0) return trig;
  const fresh = freshnessRank(b, now) - freshnessRank(a, now);
  if (fresh !== 0) return fresh;
  const source = Number(isMockSource(a.source)) - Number(isMockSource(b.source));
  if (source !== 0) return source;
  return 0; // stable — preserves registry order
}

function selectionReasonsFor(s: McpSetup, now: Date): string[] {
  const reasons: string[] = [];
  const st = String(s.status ?? "").toLowerCase();
  if (statusRank(st) >= 2) reasons.push(`Actionable status: ${st}`);
  else if (st) reasons.push(`Status: ${st}`);
  if (hasValidTrigger(s)) reasons.push(`Valid trigger present at $${s.trigger!.price.toFixed(2)}`);
  const fr = freshnessRank(s, now);
  if (fr === 2) reasons.push("Setup detected recently (fresh)");
  else if (fr === 0) reasons.push("Setup is older than the freshness window");
  return reasons;
}

/**
 * Runs the deterministic multi-strategy analysis for one symbol.
 * `onlyStrategyId` restricts to a single strategy (explicit-strategy flow).
 * Never throws for individual strategy failures — partial success is valid.
 */
export async function runMultiStrategyAnalysis(
  symbol: string,
  deps: MultiStrategyDeps,
  onlyStrategyId?: string,
): Promise<MultiStrategyAnalysis> {
  const now = deps.now ?? new Date();
  const timeframe = deps.timeframe ?? "1d";
  const sym = symbol.toUpperCase();

  let registry: StrategyMeta[] = [];
  try {
    registry = await getCachedStrategyRegistry(deps.listStrategies, now.getTime());
  } catch {
    registry = [];
  }

  let eligible = registry.filter(
    (s) => s.enabled && s.targetedScan && s.supportedTimeframes.includes(timeframe),
  );
  if (onlyStrategyId) {
    eligible = eligible.filter((s) => s.id.toLowerCase() === onlyStrategyId.toLowerCase());
  }

  const base: MultiStrategyAnalysis = {
    symbol: sym,
    generatedAt: now.toISOString(),
    timeframe,
    strategiesChecked: eligible.length,
    strategiesMatched: 0,
    strategiesFailed: 0,
    overallVerdict: "INSUFFICIENT_DATA",
    primarySetup: null,
    supportingSetups: [],
    dataQuality: { source: "unknown", realMarketData: false, fresh: null, complete: false },
  };
  if (eligible.length === 0) return base;

  const timeoutMs = deps.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY;

  // Order-stable collection: mapBounded preserves input (registry) order in
  // its result array regardless of completion order, so comparator ties keep
  // a deterministic registry-order ranking.
  type ScanOutcome =
    | { kind: "match"; meta: StrategyMeta; setup: McpSetup }
    | { kind: "noMatch"; meta: StrategyMeta }
    | { kind: "failed"; meta: StrategyMeta; safeErrorCode: string };
  const outcomes = await mapBounded(eligible, concurrency, async (meta): Promise<ScanOutcome> => {
    try {
      const raw = scrubUntrusted(await withTimeout(deps.scanStrategy(sym, meta.id, timeframe), timeoutMs));
      const setup = extractSetup(raw);
      if (setup) {
        // Every returned setup is preserved independently; enrich display name.
        return { kind: "match", meta, setup: { ...setup, strategyDisplayName: setup.strategyDisplayName ?? meta.displayName } };
      }
      return { kind: "noMatch", meta };
    } catch (err: any) {
      // Diagnostic instrumentation: log the SPECIFIC failure cause, not just
      // MCP_TOOL_ERROR. Message is engine/provider error text (no secrets);
      // truncated defensively. Behavior unchanged — outcome still "failed".
      const message = String(err?.message ?? "").slice(0, 500);
      // Best-effort mapped slug for the log (adapter may itself be the failure).
      let mcpSlug: string | null = null;
      try {
        const { toMcpStrategyId } = await import("./strategy-contract-adapter");
        mcpSlug = toMcpStrategyId(meta.id);
      } catch {
        /* unmapped — leave null */
      }
      console.warn(
        JSON.stringify({
          event: "scan_strategy_failed",
          symbol: sym,
          strategyRequested: meta.id,
          resolvedStrategyId: mcpSlug, // MCP slug sent by the contract adapter (null when unmapped)
          timeframe,
          code: String(err?.code ?? "SCAN_FAILED"),
          cause: classifyScanFailure(err?.code, message),
          message,
          stackTop: String(err?.stack ?? "").split("\n")[1]?.trim() ?? null,
        }),
      );
      return { kind: "failed", meta, safeErrorCode: String(err?.code ?? "SCAN_FAILED").slice(0, 40) };
    }
  });
  const matched = outcomes.filter((o): o is Extract<ScanOutcome, { kind: "match" }> => o.kind === "match");
  const noMatch = outcomes.filter((o) => o.kind === "noMatch").map((o) => o.meta.displayName);
  const failed = outcomes
    .filter((o): o is Extract<ScanOutcome, { kind: "failed" }> => o.kind === "failed")
    .map((o) => ({ strategy: o.meta.displayName, safeErrorCode: o.safeErrorCode }));

  base.strategiesMatched = matched.length;
  base.strategiesFailed = failed.length;
  if (noMatch.length) base.noMatchStrategies = noMatch;
  if (failed.length) base.failedStrategies = failed;

  // All scans failed → nothing usable.
  if (matched.length === 0 && failed.length === eligible.length) {
    base.overallVerdict = "INSUFFICIENT_DATA";
    return base;
  }

  // Deterministic ordering (never a raw cross-strategy score sort).
  const ordered = [...matched].sort((a, b) => compareSetups(a.setup, b.setup, now));

  // Candidate qualification for the strongest setups — capped.
  const toBuild = ordered.slice(0, MAX_CANDIDATE_BUILDS);
  const built = await mapBounded(toBuild, Math.min(concurrency, MAX_CANDIDATE_BUILDS), async ({ setup }) => {
    try {
      const c = scrubUntrusted(await withTimeout(deps.buildTradeCandidate(sym, setup.strategy), timeoutMs)) as McpCandidate;
      return candidateVerdict(c) ? c : null;
    } catch {
      return null; // candidate-engine failure is honest null, never fabricated
    }
  });

  const entries: MultiStrategySetupEntry[] = ordered.map(({ setup }, i) => {
    const candidate = i < built.length ? built[i] : undefined;
    const candidateCheck = deriveCandidateCheck(candidate);
    return { setup, candidate, ...(candidateCheck ? { candidateCheck } : {}) };
  });

  // Candidate qualification can promote a supporting setup to primary (§3.8f):
  // a qualified candidate outranks an unqualified one at equal deterministic rank.
  let primaryIdx = 0;
  if (entries.length > 1) {
    const firstQualified = entries.findIndex((e) => isQualifiedVerdict(candidateVerdict(e.candidate ?? null)));
    if (firstQualified > 0 && !isQualifiedVerdict(candidateVerdict(entries[0].candidate ?? null))) {
      primaryIdx = firstQualified;
    }
  }
  const primary = entries[primaryIdx] ?? null;
  const supporting = entries.filter((_, i) => i !== primaryIdx);

  if (primary) {
    const reasons = selectionReasonsFor(primary.setup, now);
    if (primaryIdx !== 0) reasons.unshift("Qualified as a trade candidate by the deterministic candidate engine");
    const pv = candidateVerdict(primary.candidate ?? null);
    if (pv) reasons.push(`Candidate verdict: ${pv}`);
    base.primarySetup = { ...primary, selectionReasons: reasons };
  }
  base.supportingSetups = supporting;

  // --- Overall verdict (§5 — deterministic; the LLM may never override) ---
  const verdicts = entries.map((e) => candidateVerdict(e.candidate ?? null));
  const anyQualified = verdicts.some((v) => isQualifiedVerdict(v));
  const evaluated = verdicts.filter((v) => v != null);
  const anyFreshEvidence = entries.some(
    (e) => freshnessRank(e.setup, now) !== 0 && statusRank(e.setup.status) >= 1,
  );
  // Precedence note (§5 vs §8): the spec's own presentation example shows
  // Overall WATCH with a forming primary whose candidate is "No qualified
  // trade yet" — so fresh forming/ready evidence yields WATCH even when
  // evaluated candidates returned NO_TRADE. NO_TRADE is reserved for setups
  // that are all stale/invalid or explicitly rejected with no fresh evidence.
  if (anyQualified) base.overallVerdict = "TRADE_CANDIDATE";
  else if (matched.length > 0 && anyFreshEvidence) base.overallVerdict = "WATCH";
  else if (matched.length > 0 || (evaluated.length > 0 && evaluated.every((v) => v === "NO_TRADE"))) base.overallVerdict = "NO_TRADE";
  else if (noMatch.length > 0) base.overallVerdict = "NO_TRADE"; // evaluated, nothing qualifies
  else base.overallVerdict = "INSUFFICIENT_DATA";

  // --- Market context (from the primary candidate, never invented) ---
  const pc = primary?.candidate ?? null;
  base.marketContext = {
    price: primary?.setup.currentPrice ?? null,
    trend: null,
    marketRegime: pc?.marketRegime?.regime ?? null,
    earningsRisk: pc?.earningsRisk?.status ?? null,
  };

  // --- Data quality ---
  const sources = matched.map((m) => m.setup.source).filter((s): s is string => typeof s === "string" && !!s);
  const anyMock = sources.some(isMockSource);
  const freshRanks = matched.map((m) => freshnessRank(m.setup, now));
  const fresh: boolean | null =
    matched.length === 0 ? null : freshRanks.every((r) => r === 1) ? null : freshRanks.some((r) => r === 2) ? true : false;
  const complete =
    !!primary &&
    (isQualifiedVerdict(candidateVerdict(primary.candidate ?? null)) ||
      candidateVerdict(primary.candidate ?? null) === "NO_TRADE" ||
      (hasValidTrigger(primary.setup) && typeof primary.setup.invalidation?.price === "number"));
  base.dataQuality = {
    source: anyMock ? "mock" : sources[0] ?? "scanner",
    realMarketData: sources.length > 0 && !anyMock,
    fresh,
    complete,
  };

  return base;
}

// ---------------------------------------------------------------------------
// Confidence (§11 — data completeness/agreement only, never direction)
// ---------------------------------------------------------------------------

export function multiStrategyConfidence(a: MultiStrategyAnalysis): "low" | "medium" | "high" {
  const succeeded = a.strategiesChecked - a.strategiesFailed;
  if (a.strategiesChecked === 0 || succeeded === 0) return "low";
  if (a.overallVerdict === "INSUFFICIENT_DATA") return "low";
  if (!a.dataQuality.realMarketData) return "low"; // mock/synthetic anywhere
  if (a.strategiesFailed > succeeded) return "low"; // most strategies failed
  if (a.dataQuality.fresh !== true) return "medium"; // unknown/stale freshness caps at medium
  // High requires broad successful coverage AND complete primary evidence.
  // Bearish/NO_TRADE with complete data is still high confidence.
  if (succeeded >= 3 && a.dataQuality.complete) return "high";
  return "medium";
}

// ---------------------------------------------------------------------------
// Suggestions / CTAs (§12)
// ---------------------------------------------------------------------------

export function suggestionsForMultiStrategy(
  a: MultiStrategyAnalysis,
): { label: string; href: string }[] {
  const sym = a.symbol;
  const viewSetup = { label: `View ${sym} setup`, href: `/charts/${sym}` };
  const scanner = { label: "Open Scanner", href: "/trade-finder" };
  const radar = { label: "Find other opportunities", href: "/opportunity-radar" };
  switch (a.overallVerdict) {
    case "TRADE_CANDIDATE": {
      const actionable =
        statusRank(a.primarySetup?.setup.status) >= 2 && hasValidTrigger(a.primarySetup!.setup);
      return [
        viewSetup,
        ...(actionable ? [{ label: "Open Trade Builder", href: `/trade-finder?symbol=${sym}` }] : []),
        { label: "Compare strategies", href: "/opportunity-radar" },
      ];
    }
    case "WATCH":
      return [{ label: "Add to Watchlist", href: "/watchlist" }, viewSetup, scanner];
    case "NO_TRADE":
    default:
      return [scanner, radar];
  }
}

// ---------------------------------------------------------------------------
// Deterministic fallback prose (when OpenAI is unavailable)
// ---------------------------------------------------------------------------

export function buildMultiStrategyFallbackAnswer(a: MultiStrategyAnalysis): {
  headline: string;
  answer: string;
  keyPoints: string[];
  riskNote: string;
} {
  const p = a.primarySetup?.setup;
  const name = p?.strategyDisplayName ?? p?.strategy;
  const headline =
    a.overallVerdict === "TRADE_CANDIDATE"
      ? `${a.symbol}: ${name} setup currently qualifies as a trade candidate.`
      : a.overallVerdict === "WATCH"
        ? `${a.symbol}: ${name ? `${name} setup detected` : "setup detected"} — no qualified trade yet.`
        : a.overallVerdict === "NO_TRADE"
          ? `${a.symbol}: no strategy currently qualifies as a trade.`
          : `${a.symbol}: analysis data is currently unavailable.`;
  const lines: string[] = [
    `Checked ${a.strategiesChecked} strategies on ${a.symbol}: ${a.strategiesMatched} matched, ${a.strategiesChecked - a.strategiesMatched - a.strategiesFailed} no current setup${a.strategiesFailed ? `, ${a.strategiesFailed} unavailable` : ""}.`,
  ];
  if (p) {
    lines.push(
      `Primary: ${name}${p.status ? ` (${p.status})` : ""}${typeof p.trigger?.price === "number" ? `, trigger $${p.trigger.price.toFixed(2)}` : ""}.`,
    );
  }
  lines.push("Scanner detections are AI-generated analysis, not recommendations.");
  return {
    headline,
    answer: lines.join(" "),
    keyPoints: (a.primarySetup?.selectionReasons ?? []).slice(0, 5),
    riskNote: "AI-generated educational analysis — not investment advice. Confirm everything in your own broker before acting.",
  };
}
