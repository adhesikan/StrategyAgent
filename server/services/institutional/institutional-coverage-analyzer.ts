/**
 * Generic institutional mapping coverage analysis and guarded remediation.
 * Analysis is SELECT-only; writes are available only through the explicitly
 * gated, hash-bound executor below.
 */
import { createHash } from "node:crypto";
import {
  resolveInstitutionalSecurity,
  type SecurityResolutionEvidence,
  type SecurityResolverOutcome,
} from "./security-resolver";

export type CoverageCategory =
  | "TRUSTED" | "AMBIGUOUS" | "CONFLICTING" | "UNSUPPORTED" | "INSUFFICIENT_NO_REFERENCE";

export interface CusipEvidence {
  cusip: string;
  holdingRows: number;
  nullValueRows?: number;
  staleUnmappedHoldingRows?: number;
  staleUnmappedValueUsd?: string | null;
  currentlyMaterializedHoldingRows?: number;
  currentlyMaterializedValueUsd?: string | null;
  /** Exact database bigint/numeric text; null remains unavailable, never zero. */
  reportedValueUsd: string | number | null;
  latestQuarter: string | null;
  /** All canonical effective periods containing an eligible holding for this CUSIP. */
  periods?: string[];
  holdingSymbols?: string[];
  reliableReferenceSymbols?: string[];
  hasUnreliableReference?: boolean;
  /** Bound source/symbol/status records passed unchanged to the shared resolver. */
  sourceEvidence?: SecurityResolutionEvidence[];
}

export interface CusipClassification extends CusipEvidence {
  category: CoverageCategory;
  resolverOutcome: SecurityResolverOutcome;
  sourceEvidence: SecurityResolutionEvidence[];
  projectedSymbol: string | null;
  remediation: "NONE" | "REVIEW_CANONICAL_MAPPING" | "RESOLVE_CONFLICT";
}

export interface CoveragePlan {
  version: 1;
  mode: "REMEDIATION_PLAN";
  before: CoverageTotals;
  projected: CoverageTotals;
  classifications: CusipClassification[];
  affected: {
    mappings: string[];
    holdings: number;
    quarters: string[];
    aggregates: string[];
    signals: string[];
    snapshots: string[];
  };
  operations?: CoveragePlanOperation[];
  idempotency?: string[];
  rollback?: { action: string; sql: string };
  downstream?: {
    aggregates: { expected: number; present: number; missing: number; coveragePercent: number; inserts: number; updates: number };
    signals: { expected: number; present: number; missing: number; coveragePercent: number; inserts: number; updates: number };
    snapshots: { currentRowsByFamily: Record<string, number>; refreshFamilies: string[] };
  };
  planHash: string;
}

export interface CoveragePlanOperation {
  cusip: string;
  symbol: string;
  mappingAction: "NONE" | "PROMOTE_TRUSTED_REFERENCE";
  mappingStatus: "exact" | "reviewed";
  mappingMethod: string;
  holdingUpdateRows: number;
  periods: string[];
  aggregateTargets: Array<{ symbol: string; period: string; action: "insert" | "update" }>;
  signalTarget: { symbol: string; action: "insert" | "update" } | null;
}

export interface CoverageTotals {
  eligibleCusips: number;
  holdingRows: number;
  /** Sum of known reported values only. See nullValueCusips for excluded rows. */
  reportedValueUsd: string | null;
  nullValueCusips: number;
  nullValueRows: number;
  knownValueCusips: number;
  reliablyMappedCusips: number;
  reliablyMappedValueUsd: string | null;
  reliablyMappedKnownValueCusips: number;
  currentlyMaterializedHoldingRows: number;
  currentlyMaterializedValueUsd: string | null;
  currentlyFullyMaterializedCusips: number;
  fullyMaterializedCusipPercent: number;
  materializedRowPercent: number;
  materializedKnownValuePercent: number | null;
}

export interface CoverageCategoryMetric {
  category: CoverageCategory;
  cusips: number;
  holdingRows: number;
  latestQuarterRows: number;
  knownValueUsd: string;
  nullValueRows: number;
  cusipPercent: number;
  rowPercent: number;
  valuePercent: number | null;
}

function percent(numerator: bigint, denominator: bigint): number | null {
  if (denominator === BigInt(0)) return null;
  return Number((numerator * BigInt(1_000_000)) / denominator) / 10_000;
}

export function categoryCoverageMetrics(
  rows: CusipClassification[],
  latestRowsByCusip: Readonly<Record<string, number>> = {},
): CoverageCategoryMetric[] {
  const totalRows = rows.reduce((n, row) => n + row.holdingRows, 0);
  const known = rows.filter(row => row.reportedValueUsd !== null);
  const totalKnownValue = known.reduce((n, row) => n + BigInt(String(row.reportedValueUsd)), BigInt(0));
  const categories: CoverageCategory[] = ["TRUSTED", "AMBIGUOUS", "CONFLICTING", "UNSUPPORTED", "INSUFFICIENT_NO_REFERENCE"];
  return categories.map(category => {
    const selected = rows.filter(row => row.category === category);
    const holdingRows = selected.reduce((n, row) => n + row.holdingRows, 0);
    const knownValue = selected.filter(row => row.reportedValueUsd !== null)
      .reduce((n, row) => n + BigInt(String(row.reportedValueUsd)), BigInt(0));
    return {
      category, cusips: selected.length, holdingRows,
      latestQuarterRows: selected.reduce((n, row) => n + (latestRowsByCusip[row.cusip] ?? 0), 0),
      knownValueUsd: knownValue.toString(),
      nullValueRows: selected.reduce((n, row) => n + Number(row.nullValueRows ?? 0), 0),
      cusipPercent: percent(BigInt(selected.length), BigInt(rows.length)) ?? 0,
      rowPercent: percent(BigInt(holdingRows), BigInt(totalRows)) ?? 0,
      valuePercent: percent(knownValue, totalKnownValue),
    };
  });
}

export function rankCoverageRootCauses(metrics: CoverageCategoryMetric[]): CoverageCategoryMetric[] {
  return metrics.filter(metric => metric.category !== "TRUSTED").sort((a, b) => {
    const valueOrder = BigInt(b.knownValueUsd) > BigInt(a.knownValueUsd) ? 1
      : BigInt(b.knownValueUsd) < BigInt(a.knownValueUsd) ? -1 : 0;
    return valueOrder || b.holdingRows - a.holdingRows || a.category.localeCompare(b.category);
  });
}

export function buildActionableCoveragePlan(input: {
  classifications: CusipClassification[];
  before: CoverageTotals;
  existingAggregateTargets?: ReadonlySet<string>;
  existingSignalSymbols?: ReadonlySet<string>;
  snapshotRowsByFamily?: Readonly<Record<string, number>>;
}): CoveragePlan {
  const operations: CoveragePlanOperation[] = [...input.classifications]
    .sort((a, b) => a.cusip.localeCompare(b.cusip))
    .filter(row => row.category === "TRUSTED" && row.projectedSymbol)
    .map(row => {
      const trusted = row.sourceEvidence
        .filter(evidence => evidence.symbol?.trim().toUpperCase() === row.projectedSymbol &&
          ["exact", "reviewed"].includes(evidence.status?.trim().toLowerCase() ?? ""))
        .sort((a, b) => Number(b.status?.toLowerCase() === "reviewed") - Number(a.status?.toLowerCase() === "reviewed"))[0];
      if (!trusted) throw new Error(`TRUSTED_EVIDENCE_MISSING:${row.cusip}`);
      return ({
      cusip: row.cusip, symbol: row.projectedSymbol!,
      mappingAction: (row.staleUnmappedHoldingRows ?? 0) > 0 ? "PROMOTE_TRUSTED_REFERENCE" as const : "NONE" as const,
      mappingStatus: trusted.status!.trim().toLowerCase() as "exact" | "reviewed",
      mappingMethod: `coverage_resolver:${trusted.source}`,
      holdingUpdateRows: row.staleUnmappedHoldingRows ?? 0,
      periods: [...(row.periods ?? [])].sort(),
      aggregateTargets: [...(row.periods ?? [])].sort().map(period => {
        const key = `${row.projectedSymbol}:${period}`;
        return { symbol: row.projectedSymbol!, period, action: input.existingAggregateTargets?.has(key) ? "update" as const : "insert" as const };
      }),
      signalTarget: { symbol: row.projectedSymbol!, action: input.existingSignalSymbols?.has(row.projectedSymbol!) ? "update" as const : "insert" as const },
    }); });
  const seenAggregates = new Set<string>();
  const seenSignals = new Set<string>();
  for (const operation of operations) {
    operation.aggregateTargets = operation.aggregateTargets.filter(target => {
      const key = `${target.symbol}:${target.period}`;
      if (seenAggregates.has(key)) return false;
      seenAggregates.add(key); return true;
    });
    if (operation.signalTarget) {
      if (seenSignals.has(operation.signalTarget.symbol)) operation.signalTarget = null;
      else seenSignals.add(operation.signalTarget.symbol);
    }
  }
  const affected = {
    mappings: operations.filter(x => x.mappingAction !== "NONE").map(x => x.cusip),
    holdings: operations.reduce((n, x) => n + x.holdingUpdateRows, 0),
    quarters: Array.from(new Set(operations.flatMap(x => x.periods))).sort(),
    aggregates: operations.flatMap(x => x.aggregateTargets.map(t => `${t.action}:${t.symbol}:${t.period}`)),
    signals: operations.flatMap(x => x.signalTarget ? [`${x.signalTarget.action}:${x.signalTarget.symbol}`] : []),
    snapshots: operations.some(x => x.aggregateTargets.length || x.signalTarget)
      ? ["sector_intelligence_snapshots", "theme_intelligence_snapshots"] : [],
  };
  const expectedAggregates = operations.flatMap(x => x.aggregateTargets);
  const expectedSignals = operations.flatMap(x => x.signalTarget ? [x.signalTarget] : []);
  const projected = operations.reduce<CoverageTotals>((metrics, operation) => {
    const row = input.classifications.find(item => item.cusip === operation.cusip)!;
    metrics.currentlyMaterializedHoldingRows += operation.holdingUpdateRows;
    if (operation.holdingUpdateRows > 0) metrics.currentlyFullyMaterializedCusips++;
    if (metrics.currentlyMaterializedValueUsd !== null && row.staleUnmappedValueUsd !== null && row.staleUnmappedValueUsd !== undefined) {
      metrics.currentlyMaterializedValueUsd = (BigInt(metrics.currentlyMaterializedValueUsd) + BigInt(row.staleUnmappedValueUsd)).toString();
    } else if (row.staleUnmappedValueUsd === null) metrics.currentlyMaterializedValueUsd = null;
    return metrics;
  }, { ...input.before });
  projected.fullyMaterializedCusipPercent =
    percent(BigInt(projected.currentlyFullyMaterializedCusips), BigInt(projected.eligibleCusips)) ?? 0;
  projected.materializedRowPercent =
    percent(BigInt(projected.currentlyMaterializedHoldingRows), BigInt(projected.holdingRows)) ?? 0;
  projected.materializedKnownValuePercent =
    projected.currentlyMaterializedValueUsd === null || projected.reportedValueUsd === null ? null
      : percent(BigInt(projected.currentlyMaterializedValueUsd), BigInt(projected.reportedValueUsd));
  return buildCoveragePlan({
    version: 1, mode: "REMEDIATION_PLAN", before: input.before,
    projected, classifications: input.classifications, affected, operations,
    idempotency: ["mapping upsert by CUSIP", "holding update only when stale", "aggregate upsert by symbol+period", "signal upsert by symbol"],
    rollback: {
      action: "SQL rollback covers pre-commit failures. After commit, source mapping repairs remain durable; rerun dry-run and execute its new hash-bound idempotent derived-target plan.",
      sql: "ROLLBACK; -- valid only before the source-repair transaction commits",
    },
    downstream: {
      aggregates: {
        expected: expectedAggregates.length,
        present: expectedAggregates.filter(x => x.action === "update").length,
        missing: expectedAggregates.filter(x => x.action === "insert").length,
        coveragePercent: percent(BigInt(expectedAggregates.filter(x => x.action === "update").length), BigInt(expectedAggregates.length)) ?? 0,
        inserts: expectedAggregates.filter(x => x.action === "insert").length,
        updates: expectedAggregates.filter(x => x.action === "update").length,
      },
      signals: {
        expected: expectedSignals.length,
        present: expectedSignals.filter(x => x.action === "update").length,
        missing: expectedSignals.filter(x => x.action === "insert").length,
        coveragePercent: percent(BigInt(expectedSignals.filter(x => x.action === "update").length), BigInt(expectedSignals.length)) ?? 0,
        inserts: expectedSignals.filter(x => x.action === "insert").length,
        updates: expectedSignals.filter(x => x.action === "update").length,
      },
      snapshots: { currentRowsByFamily: { ...(input.snapshotRowsByFamily ?? {}) }, refreshFamilies: affected.snapshots },
    },
  });
}

function symbols(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((x) => x.trim().toUpperCase()).filter(Boolean))).sort();
}

/** Classifies only from persisted evidence; it never guesses a security. */
export function classifyCusipEvidence(input: CusipEvidence): CusipClassification {
  const holding = symbols(input.holdingSymbols);
  const references = symbols(input.reliableReferenceSymbols);
  const evidence = input.sourceEvidence ?? [
    ...holding.map((symbol) => ({ source: "holding", symbol, status: "exact" })),
    ...references.map((symbol) => ({ source: "institutional_mapping", symbol, status: "reviewed" })),
    ...(input.hasUnreliableReference ? [{ source: "institutional_mapping", symbol: null, status: "unsupported" }] : []),
  ];
  const resolution = resolveInstitutionalSecurity(evidence);
  const category: CoverageCategory = ({
    RESOLVED_TRUSTED: "TRUSTED", AMBIGUOUS: "AMBIGUOUS", CONFLICTING: "CONFLICTING",
    UNSUPPORTED: "UNSUPPORTED", INSUFFICIENT_EVIDENCE: "INSUFFICIENT_NO_REFERENCE",
  } as const)[resolution.outcome];
  return {
    ...input, holdingSymbols: holding, reliableReferenceSymbols: references, sourceEvidence: evidence,
    category, resolverOutcome: resolution.outcome, projectedSymbol: resolution.symbol,
    remediation: category === "TRUSTED" ? "NONE" : category === "CONFLICTING" ? "RESOLVE_CONFLICT" : "REVIEW_CANONICAL_MAPPING",
  };
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function coverageTotals(rows: CusipClassification[]): CoverageTotals {
  let knownValue = BigInt(0);
  let reliablyMappedKnownValue = BigInt(0);
  const total = rows.reduce<CoverageTotals>((total, row) => {
    const value = row.reportedValueUsd === null ? null : BigInt(String(row.reportedValueUsd));
    total.eligibleCusips++;
    total.holdingRows += Number(row.holdingRows || 0);
    total.nullValueRows += Number(row.nullValueRows || 0);
    if (value === null) {
      total.nullValueCusips++;
    } else {
      total.knownValueCusips++;
      knownValue += value;
      total.reportedValueUsd = knownValue.toString();
    }
    if (row.category === "TRUSTED") {
      total.reliablyMappedCusips++;
      if (value !== null) {
        total.reliablyMappedKnownValueCusips++;
        reliablyMappedKnownValue += value;
        total.reliablyMappedValueUsd = reliablyMappedKnownValue.toString();
      }
    }
    total.currentlyMaterializedHoldingRows += Number(row.currentlyMaterializedHoldingRows ?? 0);
    if (row.holdingRows > 0 && Number(row.currentlyMaterializedHoldingRows ?? 0) === row.holdingRows) {
      total.currentlyFullyMaterializedCusips++;
    }
    if (row.currentlyMaterializedValueUsd === null) {
      total.currentlyMaterializedValueUsd = null;
    } else if (row.currentlyMaterializedValueUsd !== undefined && total.currentlyMaterializedValueUsd !== null) {
      total.currentlyMaterializedValueUsd =
        (BigInt(total.currentlyMaterializedValueUsd) + BigInt(row.currentlyMaterializedValueUsd)).toString();
    }
    return total;
  }, {
    eligibleCusips: 0,
    holdingRows: 0,
    reportedValueUsd: rows.length === 0 ? null : "0",
    nullValueCusips: 0,
    nullValueRows: 0,
    knownValueCusips: 0,
    reliablyMappedCusips: 0,
    reliablyMappedValueUsd: null,
    reliablyMappedKnownValueCusips: 0,
    currentlyMaterializedHoldingRows: 0,
    currentlyMaterializedValueUsd: "0",
    currentlyFullyMaterializedCusips: 0,
    fullyMaterializedCusipPercent: 0,
    materializedRowPercent: 0,
    materializedKnownValuePercent: null,
  });
  total.fullyMaterializedCusipPercent =
    percent(BigInt(total.currentlyFullyMaterializedCusips), BigInt(total.eligibleCusips)) ?? 0;
  total.materializedRowPercent =
    percent(BigInt(total.currentlyMaterializedHoldingRows), BigInt(total.holdingRows)) ?? 0;
  total.materializedKnownValuePercent = total.currentlyMaterializedValueUsd === null || total.reportedValueUsd === null
    ? null : percent(BigInt(total.currentlyMaterializedValueUsd), BigInt(total.reportedValueUsd));
  return total;
}

export function buildCoveragePlan(input: Omit<CoveragePlan, "planHash">): CoveragePlan {
  const classifications = [...input.classifications].sort((a, b) => a.cusip.localeCompare(b.cusip));
  const canonical = { ...input, classifications, affected: {
    ...input.affected,
    mappings: [...input.affected.mappings].sort(), quarters: [...input.affected.quarters].sort(),
    aggregates: [...input.affected.aggregates].sort(), signals: [...input.affected.signals].sort(),
    snapshots: [...input.affected.snapshots].sort(),
  }};
  return { ...canonical, planHash: createHash("sha256").update(stableJson(canonical)).digest("hex") };
}

export function assertReadOnlySql(statement: string): void {
  // Remove comments and quoted values before keyword checks. In particular,
  // a value such as LOWER(put_call) = 'call' is not a CALL statement.
  const withoutComments = statement.replace(/\/\*[\s\S]*?\*\/|--[^\n]*/g, "");
  const withoutLiterals = withoutComments
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
  const normalized = withoutLiterals.trim().toUpperCase();
  if (!/^(SELECT|WITH)\b/.test(normalized) || /;\s*\S/.test(normalized) ||
    /\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|CREATE|COPY|CALL|DO|GRANT|REVOKE|VACUUM|SET)\b/.test(normalized)) {
    throw new Error("READ_ONLY_SQL_REQUIRED");
  }
}

export function validateCoverageApplyRequest(input: {
  apply: boolean; environment?: string; confirmation?: string; planHash?: string; suppliedPlanHash?: string;
  expectedDatabase?: string; currentDatabase?: string; expectedSchema?: string; currentSchema?: string;
}): string[] {
  if (!input.apply) return [];
  const issues: string[] = [];
  if (input.environment !== "production") issues.push("PRODUCTION_ENVIRONMENT_REQUIRED");
  if (input.confirmation !== "APPLY_INSTITUTIONAL_COVERAGE_PLAN") issues.push("CONFIRMATION_REQUIRED");
  if (!input.expectedDatabase || input.expectedDatabase !== input.currentDatabase) issues.push("DATABASE_IDENTITY_MISMATCH");
  if (!input.expectedSchema || input.expectedSchema !== input.currentSchema) issues.push("SCHEMA_IDENTITY_MISMATCH");
  if (!input.planHash || input.planHash !== input.suppliedPlanHash) issues.push("FRESH_PLAN_HASH_REQUIRED");
  return issues;
}

export const GLOBAL_COVERAGE_ADVISORY_LOCK = 774_412_190;

export interface CoverageApplyDatabase {
  identity(): Promise<{ database: string; schema: string }>;
  withAdvisoryLock<T>(key: number, fn: () => Promise<T>): Promise<T>;
  transaction<T>(fn: (tx: CoverageApplyTransaction) => Promise<T>): Promise<T>;
}
export interface CoverageApplyTransaction {
  loadPlan(): Promise<CoveragePlan>;
  promoteMapping(operation: CoveragePlanOperation): Promise<void>;
  updateHoldings(operation: CoveragePlanOperation): Promise<void>;
  upsertAggregate(target: CoveragePlanOperation["aggregateTargets"][number]): Promise<void>;
  upsertSignal(target: NonNullable<CoveragePlanOperation["signalTarget"]>): Promise<void>;
}
export interface CoverageRebuilder {
  rebuildAggregates?(targets: CoveragePlanOperation["aggregateTargets"]): Promise<void>;
  rebuildSignals?(targets: Array<NonNullable<CoveragePlanOperation["signalTarget"]>>): Promise<void>;
  refreshSnapshots(targets: string[]): Promise<void>;
}

/**
 * Guarded generic executor. Database adapters must implement idempotent
 * upserts/updates. A fresh plan is reloaded and hash-checked while the advisory
 * lock and database transaction are both held.
 */
export async function applyInstitutionalCoveragePlan(input: {
  database: CoverageApplyDatabase; rebuilder: CoverageRebuilder; artifact: CoveragePlan;
  environment?: string; confirmation?: string; expectedDatabase?: string; expectedSchema?: string;
  suppliedPlanHash?: string;
}): Promise<{ planHash: string; operations: number }> {
  const identity = await input.database.identity();
  const issues = validateCoverageApplyRequest({
    apply: true, environment: input.environment, confirmation: input.confirmation,
    expectedDatabase: input.expectedDatabase, currentDatabase: identity.database,
    expectedSchema: input.expectedSchema, currentSchema: identity.schema,
    planHash: input.artifact.planHash, suppliedPlanHash: input.suppliedPlanHash,
  });
  if (issues.length) throw new Error(`COVERAGE_APPLY_REJECTED:${issues.join(",")}`);
  const operations = input.artifact.operations ?? [];
  await input.database.withAdvisoryLock(GLOBAL_COVERAGE_ADVISORY_LOCK, async () => {
    await input.database.transaction(async (tx) => {
      const fresh = await tx.loadPlan();
      if (fresh.planHash !== input.artifact.planHash) throw new Error("COVERAGE_APPLY_REJECTED:STALE_PLAN_HASH");
      for (const operation of operations) {
        if (operation.mappingAction === "PROMOTE_TRUSTED_REFERENCE") {
          await tx.promoteMapping(operation);
          await tx.updateHoldings(operation);
        }
        for (const target of operation.aggregateTargets) await tx.upsertAggregate(target);
        if (operation.signalTarget) await tx.upsertSignal(operation.signalTarget);
      }
    });
  });
  const aggregateTargets = operations.flatMap(operation => operation.aggregateTargets);
  const signalTargets = operations.flatMap(operation => operation.signalTarget ? [operation.signalTarget] : []);
  if (input.rebuilder.rebuildAggregates) await input.rebuilder.rebuildAggregates(aggregateTargets);
  if (input.rebuilder.rebuildSignals) await input.rebuilder.rebuildSignals(signalTargets);
  // Derived snapshots are bounded to the exact targets in the hashed artifact.
  await input.rebuilder.refreshSnapshots(input.artifact.affected.snapshots);
  return { planHash: input.artifact.planHash, operations: operations.length };
}