// Internal service-to-service scanner API (vcp-trader-mcp Sprint 1B).
//
//   GET /api/internal/scanner/strategies
//   GET /api/internal/scanner/setup?symbol=NVDA&strategy=VCP&timeframe=1d
//   GET /api/internal/scanner/opportunities?strategies=VCP,ORB5&direction=bullish&limit=10
//
// Exposes existing scanner intelligence (strategy metadata + stored scheduled
// scan results in the `opportunities` table) to the external vcp-trader-mcp
// Railway service. This module NEVER runs a scan: all setup/opportunity data
// comes from rows the scheduled scanner already stored, so calling these
// routes cannot trigger market-data fetches or a full-market scan.
//
// Auth: Authorization: Bearer <VCP_INTERNAL_API_KEY> — reuses the same
// constant-time internalApiKeyAuth as /api/internal/market/history. Backend
// services only; no user session; token never logged or sent to a browser.
//
// Data safety: responses contain scanner intelligence only. userId, internal
// row ids, and dedupeKey are stripped; there is no broker/account/order data
// in the source table at all.

import type { Express, Request, Response } from "express";
import { desc, eq, inArray, and, or, gte, isNotNull, type SQL } from "drizzle-orm";
import { db } from "../db";
import { opportunities as opportunitiesTable, type Opportunity } from "@shared/schema";
import { StrategyId, type StrategyIdType } from "../strategies/types";
import { STRATEGY_CONFIGS, getStrategyDisplayName } from "@shared/strategies";
import { internalApiKeyAuth } from "./internal-market";
import { isSessionExpired, INTRADAY_SESSION_STRATEGIES } from "../opportunity-service";

// ---------------------------------------------------------------------------
// Strategy metadata (authoritative — derived from the production registry)
// ---------------------------------------------------------------------------

const SYMBOL_RE = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/;

// The scheduled scanner ingests every strategy's results with timeframe "1d"
// (server/scheduled-scan-service.ts hardcodes it), so stored setups exist for
// "1d" only. This is the truthful supported list — do not widen it until
// ingestion actually stores other timeframes.
const SUPPORTED_TIMEFRAMES = ["1d"] as const;

// Production freshness rule: the opportunity lifecycle already expires "1d"
// setups after 10 days (EXPIRATION_DAYS in server/opportunity-service.ts,
// enforced via RESOLVED/EXPIRED). `fresh` mirrors that existing rule:
// ACTIVE and detected within the last 10 days.
const FRESHNESS_MS_1D = 10 * 24 * 60 * 60 * 1000;

export type NormalizedStatus = "forming" | "ready" | "triggered" | "extended" | "invalid" | "unknown";

export interface InternalStrategyMeta {
  id: StrategyIdType;
  displayName: string;
  direction: "bullish";
  category: string;
  supportedTimeframes: string[];
  targetedScan: boolean;
  rankedOpportunities: boolean;
  enabled: boolean;
}

const CONFIG_BY_ID = new Map(STRATEGY_CONFIGS.map((c) => [c.id as string, c]));

export function listInternalStrategies(): InternalStrategyMeta[] {
  return (Object.values(StrategyId) as StrategyIdType[]).map((id) => {
    const cfg = CONFIG_BY_ID.get(id);
    return {
      id,
      displayName: cfg?.displayName ?? getStrategyDisplayName(id),
      // Every implemented scanner strategy is long-only in production: the
      // scheduled path rejects non-bullish quotes before classification.
      direction: "bullish" as const,
      category: cfg?.category ?? "Momentum Engine",
      supportedTimeframes: [...SUPPORTED_TIMEFRAMES],
      // "targetedScan" here means /setup supports a single symbol+strategy
      // lookup (served from stored scheduled results — never a live scan).
      targetedScan: true,
      rankedOpportunities: true,
      enabled: true,
    };
  });
}

// Accepts the real ID (any case), the guide slug ("momentum-breakout"), or a
// slugified display name ("momentum_breakout") so the MCP provisional
// registry's slug-style ids resolve while it reconciles against /strategies.
const STRATEGY_ALIASES: Map<string, StrategyIdType> = (() => {
  const m = new Map<string, StrategyIdType>();
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  for (const id of Object.values(StrategyId) as StrategyIdType[]) {
    m.set(slug(id), id);
    const cfg = CONFIG_BY_ID.get(id);
    if (cfg) {
      m.set(slug(cfg.displayName), id);
      m.set(slug(cfg.guideSlug), id);
      m.set(slug(cfg.legacyName), id);
    }
  }
  return m;
})();

export function resolveStrategyId(raw: string): StrategyIdType | null {
  const key = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return STRATEGY_ALIASES.get(key) ?? null;
}

// ---------------------------------------------------------------------------
// Status normalization (§7 — do not force other strategies into VCP stages)
// ---------------------------------------------------------------------------
//
// Every locally stored strategy family shares the same PatternStage contract
// (FORMING / READY / BREAKOUT) plus an opportunity *lifecycle* status
// (ACTIVE / RESOLVED with outcome BROKE_RESISTANCE / INVALIDATED / EXPIRED).
// Mapping, applied uniformly to all families because the stored contract is
// uniform (raw values always preserved in details):
//   ACTIVE   + FORMING            -> forming
//   ACTIVE   + READY              -> ready
//   ACTIVE   + BREAKOUT           -> triggered
//   RESOLVED + BROKE_RESISTANCE   -> triggered  (breakout confirmed/played out)
//   RESOLVED + INVALIDATED        -> invalid    (stop reference violated)
//   RESOLVED + EXPIRED            -> invalid    (setup went stale; no longer actionable)
//   anything else                 -> unknown
// "extended" has no truthful source in stored data and is never emitted.
export function normalizeStatus(row: Pick<Opportunity, "status" | "stageAtDetection" | "resolutionOutcome">): NormalizedStatus {
  if (row.status === "ACTIVE") {
    switch (row.stageAtDetection) {
      case "FORMING": return "forming";
      case "READY": return "ready";
      case "BREAKOUT": return "triggered";
      default: return "unknown";
    }
  }
  if (row.status === "RESOLVED") {
    switch (row.resolutionOutcome) {
      case "BROKE_RESISTANCE": return "triggered";
      case "INVALIDATED":
      case "EXPIRED":
        return "invalid";
      default: return "unknown";
    }
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Row -> wire shape (scanner intelligence only; no user/account/internal ids)
// ---------------------------------------------------------------------------

/** A price level with its basis. Never fabricated: absent source data -> null level. */
export interface PriceLevel {
  price: number;
  basis: string;
}

export interface InternalSetup {
  symbol: string;
  strategy: string;
  strategyDisplayName: string;
  direction: "bullish";
  score: number | null;
  status: NormalizedStatus;
  timeframe: string;
  trigger: PriceLevel | null;
  invalidation: PriceLevel | null;
  technicalObjective: PriceLevel | null;
  currentPrice: number | null;
  reasons: string[];
  warnings: string[];
  detectedAt: string | null;
  source: "vcp_trader";
  /**
   * True when a trigger price is available AND the row is still ACTIVE.
   * Consumers MUST check this flag before treating the setup as tradeable.
   * READY or TRIGGERED status alone does NOT imply actionability — the
   * status reflects pattern maturity; this flag reflects whether an entry
   * price exists. False when trigger is null (no level was stored or the
   * session has expired for intraday strategies).
   *
   * Future typed-trigger design (not yet implemented):
   *   trigger:
   *     | { type: "price"; price: number; basis: string }
   *     | { type: "event"; event: string; confirmation: string[] }
   *     | null
   * When that design is adopted, actionable will be derived from whether
   * a price-type trigger with a finite level is present.
   */
  actionable: boolean;
  details: {
    rawStage: string | null;
    lifecycleStatus: string | null;
    resolutionOutcome: string | null;
    rvol: number | null;
    detectedPrice: number | null;
  };
}

export function isRowFresh(row: Pick<Opportunity, "status" | "detectedAt">, now: Date = new Date()): boolean {
  if (row.status !== "ACTIVE") return false;
  const detected = row.detectedAt instanceof Date ? row.detectedAt : new Date(row.detectedAt as any);
  if (Number.isNaN(detected.getTime())) return false;
  return now.getTime() - detected.getTime() <= FRESHNESS_MS_1D;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function level(v: unknown, basis: string): PriceLevel | null {
  const price = num(v);
  return price === null ? null : { price, basis };
}

/** Maps a stored opportunity row to the wire shape. Returns null for rows too malformed to represent truthfully. */
export function toInternalSetup(row: Opportunity): InternalSetup | null {
  if (!row || typeof row.symbol !== "string" || !row.symbol || typeof row.strategyId !== "string" || !row.strategyId) {
    return null;
  }
  const detected = row.detectedAt instanceof Date ? row.detectedAt : row.detectedAt ? new Date(row.detectedAt as any) : null;
  const warnings: string[] = [];
  if (row.status === "ACTIVE" && detected && !isRowFresh(row)) {
    warnings.push("Setup is older than the 10-day freshness window and may be stale.");
  }

  // Session-expiry warning for intraday strategies (ORB5, ORB15, GAP_AND_GO).
  // The lifecycle resolver will eventually mark these EXPIRED; this warning
  // lets consumers react without waiting for the next resolve cycle.
  const now = new Date();
  if (isSessionExpired(row, now)) {
    warnings.push(
      `Intraday setup (${row.strategyId}) is from a prior ET trading session — trigger level is no longer actionable.`,
    );
  }

  // Trigger: prefer the explicitly stored entry trigger (populated by the
  // fixed ingestion path). Fall back to resistancePrice for rows stored
  // before the ingestion fix was deployed (backward compatibility).
  //
  // LIMITATION: resistancePrice then appears in both trigger and
  // technicalObjective because the scanner stores only one resistance
  // level and it serves both roles. This is truthful — for all current
  // scanner strategies the breakout trigger IS the resistance level.
  // When typed-trigger variants are introduced (see actionable comment),
  // these fields will diverge.
  const triggerPrice = num(row.entryTriggerPrice) ?? num(row.resistancePrice) ?? null;
  const trigger: PriceLevel | null =
    triggerPrice !== null ? { price: triggerPrice, basis: "breakout level" } : null;

  // actionable = trigger exists AND row is still ACTIVE AND session has not expired.
  // Preserves READY/TRIGGERED status for display purposes while being explicit
  // about whether an entry price is available. Consumers must check this flag.
  const sessionExpired = isSessionExpired(row, now);
  const actionable = trigger !== null && row.status === "ACTIVE" && !sessionExpired;

  return {
    symbol: row.symbol.toUpperCase(),
    strategy: row.strategyId,
    strategyDisplayName: row.strategyName || getStrategyDisplayName(row.strategyId),
    direction: "bullish",
    score: num(row.score),
    status: normalizeStatus(row),
    timeframe: row.timeframe || "1d",
    trigger,
    invalidation: level(row.stopReferencePrice, "setup invalidation (stop reference)"),
    // technicalObjective uses resistancePrice (the resistance/target level).
    // This may equal trigger.price when entryTriggerPrice was null (legacy rows);
    // that duplication is truthful, not fabricated.
    technicalObjective: level(row.resistancePrice, "technical objective (resistance)"),
    currentPrice: num(row.lastPrice) ?? num(row.detectedPrice),
    // reasons/warnings prose is not persisted by the scheduled scanner; empty
    // arrays are the truthful representation (do not invent narratives).
    reasons: [],
    warnings,
    detectedAt: detected && !Number.isNaN(detected.getTime()) ? detected.toISOString() : null,
    source: "vcp_trader",
    actionable,
    details: {
      rawStage: row.stageAtDetection ?? null,
      lifecycleStatus: row.status ?? null,
      resolutionOutcome: row.resolutionOutcome ?? null,
      rvol: num(row.rvol),
      detectedPrice: num(row.detectedPrice),
    },
  };
}

/**
 * Rows are stored per user (the scheduled scanner ingests per user account).
 * This service-level API exposes market intelligence, not per-user state, so
 * duplicates of the same symbol+strategy+timeframe across users collapse to
 * the most recent detection. Input must already be detectedAt DESC — the
 * production order — which this preserves; distinct strategies for the same
 * symbol remain separate entries.
 */
export function dedupeAcrossUsers(rows: Opportunity[]): Opportunity[] {
  const seen = new Set<string>();
  const out: Opportunity[] = [];
  for (const row of rows) {
    const key = `${row.symbol}|${row.strategyId}|${row.timeframe}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Data access (injectable for tests; defaults hit the production table)
// ---------------------------------------------------------------------------

/**
 * Lifecycle constraint for a normalized status, expressed as OR-ed
 * (status, stages?/outcomes?) branches so the DB filters match exactly what
 * normalizeStatus() would emit — no lifecycle subset silently omitted.
 */
export interface LifecycleBranch {
  status: "ACTIVE" | "RESOLVED";
  stages?: string[];       // stageAtDetection values (ACTIVE branches)
  outcomes?: string[];     // resolutionOutcome values (RESOLVED branches)
}

/** Maps a normalized status filter to its exact lifecycle branches. Null = no rows can ever match ("extended"). */
export function lifecycleBranchesFor(status: NormalizedStatus | ""): LifecycleBranch[] | null {
  switch (status) {
    case "":          return [{ status: "ACTIVE" }]; // default: current opportunities
    case "forming":   return [{ status: "ACTIVE", stages: ["FORMING"] }];
    case "ready":     return [{ status: "ACTIVE", stages: ["READY"] }];
    case "triggered": return [
      { status: "ACTIVE", stages: ["BREAKOUT"] },
      { status: "RESOLVED", outcomes: ["BROKE_RESISTANCE"] },
    ];
    case "invalid":   return [{ status: "RESOLVED", outcomes: ["INVALIDATED", "EXPIRED"] }];
    case "extended":  return null; // never emitted from stored data — truthfully empty
    case "unknown":   return [{ status: "ACTIVE" }, { status: "RESOLVED" }]; // post-filtered
  }
}

export interface OpportunityRowFilter {
  strategyIds?: string[];
  branches: LifecycleBranch[];
  timeframe?: string;
  minScore?: number;
  fetchLimit: number;
  offset: number;
}

export interface InternalScannerDeps {
  /** Latest rows for one symbol+strategy+timeframe, detectedAt DESC. */
  fetchSetupRows(symbol: string, strategyId: string, timeframe: string): Promise<Opportunity[]>;
  /** Matching rows, detectedAt DESC, paged via fetchLimit/offset. All filters applied DB-side. */
  fetchOpportunityRows(filter: OpportunityRowFilter): Promise<Opportunity[]>;
}

const defaultDeps: InternalScannerDeps = {
  async fetchSetupRows(symbol, strategyId, timeframe) {
    return db
      .select()
      .from(opportunitiesTable)
      .where(and(
        eq(opportunitiesTable.symbol, symbol),
        eq(opportunitiesTable.strategyId, strategyId),
        eq(opportunitiesTable.timeframe, timeframe),
      ))
      .orderBy(desc(opportunitiesTable.detectedAt))
      .limit(5);
  },
  async fetchOpportunityRows({ strategyIds, branches, timeframe, minScore, fetchLimit, offset }) {
    const conditions: SQL[] = [];
    if (strategyIds && strategyIds.length > 0) conditions.push(inArray(opportunitiesTable.strategyId, strategyIds));
    if (timeframe) conditions.push(eq(opportunitiesTable.timeframe, timeframe));
    if (minScore !== undefined) {
      conditions.push(isNotNull(opportunitiesTable.score));
      conditions.push(gte(opportunitiesTable.score, minScore));
    }
    const branchSql = branches.map((b) => {
      const parts: SQL[] = [eq(opportunitiesTable.status, b.status)];
      if (b.stages) parts.push(inArray(opportunitiesTable.stageAtDetection, b.stages));
      if (b.outcomes) parts.push(inArray(opportunitiesTable.resolutionOutcome, b.outcomes));
      return and(...parts)!;
    });
    conditions.push(branchSql.length === 1 ? branchSql[0] : or(...branchSql)!);
    return db
      .select()
      .from(opportunitiesTable)
      .where(and(...conditions))
      .orderBy(desc(opportunitiesTable.detectedAt))
      .limit(fetchLimit)
      .offset(offset);
  },
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function structuredError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

const NORMALIZED_STATUSES: NormalizedStatus[] = ["forming", "ready", "triggered", "extended", "invalid", "unknown"];
const OPP_LIMIT_DEFAULT = 20;
const OPP_LIMIT_MAX = 100;
// Page size for storage reads; pagination continues until the requested
// limit is met or storage is exhausted (bounded by OPP_MAX_PAGES).
const OPP_FETCH_LIMIT = 500;
const OPP_MAX_PAGES = 10;

export function registerInternalScannerRoutes(app: Express, deps: InternalScannerDeps = defaultDeps): void {
  // ---- 1. strategies (authoritative registry) ----
  app.get("/api/internal/scanner/strategies", internalApiKeyAuth, (_req: Request, res: Response) => {
    res.json({ strategies: listInternalStrategies(), generatedAt: new Date().toISOString() });
  });

  // ---- 2. setup (latest stored result for one symbol+strategy) ----
  app.get("/api/internal/scanner/setup", internalApiKeyAuth, async (req: Request, res: Response) => {
    const rawSymbol = String(req.query.symbol ?? "").trim();
    if (!rawSymbol || !SYMBOL_RE.test(rawSymbol)) {
      return structuredError(res, 400, "INVALID_SYMBOL", "symbol must match [A-Z][A-Z0-9.-]{0,9}");
    }
    const symbol = rawSymbol.toUpperCase();

    const rawStrategy = String(req.query.strategy ?? "").trim();
    if (!rawStrategy) {
      return structuredError(res, 400, "INVALID_STRATEGY", "strategy is required");
    }
    const strategyId = resolveStrategyId(rawStrategy);
    if (!strategyId) {
      return structuredError(res, 400, "UNSUPPORTED_STRATEGY", `Unknown strategy '${rawStrategy}'. Use GET /api/internal/scanner/strategies for the authoritative list.`);
    }

    const timeframe = String(req.query.timeframe ?? "1d").trim() || "1d";
    if (!(SUPPORTED_TIMEFRAMES as readonly string[]).includes(timeframe)) {
      return structuredError(res, 400, "UNSUPPORTED_TIMEFRAME", `timeframe must be one of: ${SUPPORTED_TIMEFRAMES.join(", ")}. Stored scanner results exist for these timeframes only.`);
    }

    try {
      const rows = await deps.fetchSetupRows(symbol, strategyId, timeframe);
      // Latest well-formed row wins; malformed stored rows are skipped, never
      // fabricated around.
      let latest: InternalSetup | null = null;
      let latestRow: Opportunity | null = null;
      for (const row of rows) {
        const setup = toInternalSetup(row);
        if (setup) { latest = setup; latestRow = row; break; }
      }
      return res.json({
        setup: latest,
        generatedAt: new Date().toISOString(),
        fresh: latestRow ? isRowFresh(latestRow) : false,
      });
    } catch (err: any) {
      console.error("[InternalScanner] setup lookup failed:", err?.message);
      return structuredError(res, 500, "STORAGE_ERROR", "Failed to read stored scanner results");
    }
  });

  // ---- 3. opportunities (stored ranked results; never a live scan) ----
  app.get("/api/internal/scanner/opportunities", internalApiKeyAuth, async (req: Request, res: Response) => {
    // strategies filter
    let strategyIds: string[] | undefined;
    const rawStrategies = String(req.query.strategies ?? "").trim();
    if (rawStrategies) {
      strategyIds = [];
      for (const part of rawStrategies.split(",").map((s) => s.trim()).filter(Boolean)) {
        const id = resolveStrategyId(part);
        if (!id) {
          return structuredError(res, 400, "UNSUPPORTED_STRATEGY", `Unknown strategy '${part}'. Use GET /api/internal/scanner/strategies for the authoritative list.`);
        }
        if (!strategyIds.includes(id)) strategyIds.push(id);
      }
    }

    // direction filter — every production strategy is bullish; a bearish
    // request truthfully returns zero rows rather than mislabeled data.
    const direction = String(req.query.direction ?? "").trim().toLowerCase();
    if (direction && direction !== "bullish" && direction !== "bearish") {
      return structuredError(res, 400, "INVALID_DIRECTION", "direction must be 'bullish' or 'bearish'");
    }

    // status filter (normalized vocabulary)
    const status = String(req.query.status ?? "").trim().toLowerCase();
    if (status && !NORMALIZED_STATUSES.includes(status as NormalizedStatus)) {
      return structuredError(res, 400, "INVALID_STATUS", `status must be one of: ${NORMALIZED_STATUSES.join(", ")}`);
    }

    // timeframe filter
    const timeframe = String(req.query.timeframe ?? "").trim();
    if (timeframe && !(SUPPORTED_TIMEFRAMES as readonly string[]).includes(timeframe)) {
      return structuredError(res, 400, "UNSUPPORTED_TIMEFRAME", `timeframe must be one of: ${SUPPORTED_TIMEFRAMES.join(", ")}`);
    }

    // minScore
    let minScore: number | undefined;
    if (req.query.minScore !== undefined) {
      const parsed = Number(req.query.minScore);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        return structuredError(res, 400, "INVALID_MIN_SCORE", "minScore must be a number between 0 and 100");
      }
      minScore = parsed;
    }

    // limit
    let limit = OPP_LIMIT_DEFAULT;
    if (req.query.limit !== undefined) {
      const parsed = Number(req.query.limit);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > OPP_LIMIT_MAX) {
        return structuredError(res, 400, "INVALID_LIMIT", `limit must be an integer between 1 and ${OPP_LIMIT_MAX}`);
      }
      limit = parsed;
    }

    const branches = lifecycleBranchesFor(status as NormalizedStatus | "");
    if (direction === "bearish" || branches === null) {
      // No bearish strategies exist in production, and "extended" is never
      // emitted from stored data — truthfully empty rather than mislabeled.
      return res.json({ opportunities: [], generatedAt: new Date().toISOString(), source: "vcp_trader" });
    }

    try {
      // Status/minScore/timeframe/strategy filters are applied DB-side, so
      // the only post-filtering here is cross-user dedupe (+ the rare
      // "unknown" post-filter). Rows arrive detectedAt DESC — the production
      // order — and stay in that order end to end (no score re-sorting).
      // Paginate until the requested limit is met or storage is exhausted,
      // so heavy cross-user duplication cannot silently underfill results.
      const result: InternalSetup[] = [];
      const seen = new Set<string>();
      let offset = 0;
      for (let page = 0; page < OPP_MAX_PAGES && result.length < limit; page++) {
        const rows = await deps.fetchOpportunityRows({
          strategyIds,
          branches,
          timeframe: timeframe || undefined,
          minScore,
          fetchLimit: OPP_FETCH_LIMIT,
          offset,
        });
        for (const row of rows) {
          const key = `${row.symbol}|${row.strategyId}|${row.timeframe}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const setup = toInternalSetup(row);
          if (!setup) continue; // malformed stored row — skip, never fabricate
          if (status && setup.status !== status) continue; // only trims "unknown"
          result.push(setup);
          if (result.length >= limit) break;
        }
        if (rows.length < OPP_FETCH_LIMIT) break; // storage exhausted
        offset += OPP_FETCH_LIMIT;
      }

      return res.json({
        opportunities: result,
        generatedAt: new Date().toISOString(),
        source: "vcp_trader",
      });
    } catch (err: any) {
      console.error("[InternalScanner] opportunities lookup failed:", err?.message);
      return structuredError(res, 500, "STORAGE_ERROR", "Failed to read stored scanner results");
    }
  });
}
