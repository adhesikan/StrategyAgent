/**
 * Deterministic, provider-neutral plan builder for population-wide 13F
 * reference enrichment.  It deliberately has no database, clock, or network
 * dependency: callers supply the complete eligible population and resolutions.
 */
import { createHash } from "node:crypto";
import {
  normalizeCusip, resolveReviewedSecurityReference, type SecurityReferenceEvidence,
  resolveProviderSecurityReference, type SecurityReferenceOutcome, type SecurityReferenceResolution,
} from "./security-reference-enrichment";

export type ReferencePlanOutcome =
  | "authoritatively_resolvable" | "conflicting" | "ambiguous" | "unsupported"
  | "no_reference" | "provider_failed" | "rate_limited" | "partial";

export interface EligibleReferencePopulationRow {
  cusip: string;
  holdingRows: number;
  /** Aggregate reported value in USD text. Null means unavailable, not zero. */
  reportedValueUsd: string | null;
}
export interface TrustedReferenceState {
  cusip: string;
  evidence: readonly SecurityReferenceEvidence[];
  /** True only for a persisted exact/reviewed mapping already safe to use. */
  trusted?: boolean;
  /** A rejected local record is an explicit block on automated enrichment. */
  blocked?: boolean;
}
export interface ReferencePlanAction {
  cusip: string;
  /** Resolver-governed effective outcome retained with the provider observation. */
  effectiveOutcome: SecurityReferenceOutcome;
  symbol: string | null;
  promotable: boolean;
  resolution: SecurityReferenceResolution;
}
export interface ReferenceCoverage {
  distinctCusips: number;
  holdingRows: number;
  knownReportedValueUsd: string | null;
  knownValueCusips: number;
}
export interface ReferenceOutcomeCount extends ReferenceCoverage { outcome: ReferencePlanOutcome; }
export interface InstitutionalSecurityReferencePlan {
  version: 1;
  maxCusips: number;
  before: ReferenceCoverage;
  projected: ReferenceCoverage;
  outcomes: ReferenceOutcomeCount[];
  /** Bounded, sorted persistence action set. This is exactly what is hashed. */
  actions: ReferencePlanAction[];
  actionCounts: { requestedCusipLimit: number; plannedLookups: number; plannedWrites: number; promotable: number; skippedByLimit: number };
  planHash: string;
}

const outcomeOrder: ReferencePlanOutcome[] = [
  "authoritatively_resolvable", "conflicting", "ambiguous", "unsupported",
  "no_reference", "provider_failed", "rate_limited", "partial",
];
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${stableJson(row[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function percentValue(rows: EligibleReferencePopulationRow[], include: (row: EligibleReferencePopulationRow) => boolean): ReferenceCoverage {
  const selected = rows.filter(include);
  const known = selected.filter(row => row.reportedValueUsd !== null);
  return {
    distinctCusips: selected.length,
    holdingRows: selected.reduce((n, row) => n + row.holdingRows, 0),
    knownReportedValueUsd: known.length ? known.reduce((n, row) => n + BigInt(row.reportedValueUsd!), BigInt(0)).toString() : null,
    knownValueCusips: known.length,
  };
}
function stateIsTrusted(state: TrustedReferenceState): boolean {
  // A repository may provide an already-resolved trusted-state bit, but any
  // supplied evidence takes precedence so contradictory exact/reviewed records
  // can never be counted merely because one SQL row was trusted.
  if (state.blocked) return false;
  return state.evidence.length === 0 ? state.trusted === true :
    resolveReviewedSecurityReference(state.cusip, state.evidence).outcome === "AUTHORITATIVELY_RESOLVABLE";
}
function planOutcome(resolution: SecurityReferenceResolution | undefined, state: TrustedReferenceState): { outcome: ReferencePlanOutcome; resolution?: SecurityReferenceResolution } {
  if (state.blocked) return { outcome: "unsupported" };
  // Never trust a SQL status flag alone: Task #189 resolves conflicting
  // reviewed/exact evidence before it can count toward current coverage.
  if (stateIsTrusted(state)) return { outcome: "authoritatively_resolvable" };
  if (!resolution) return { outcome: "partial" };
  if (["PROVIDER_FAILED", "RATE_LIMITED", "PARTIAL_RESPONSE"].includes(resolution.outcome)) {
    return { outcome: resolution.outcome === "PARTIAL_RESPONSE" ? "partial" : resolution.outcome.toLowerCase() as ReferencePlanOutcome, resolution };
  }
  // Re-evaluate successful provider candidates with the reviewed precedence
  // rule; no ticker/name inference is performed here.
  const resolved = resolveReviewedSecurityReference(state.cusip, state.evidence, resolution.candidates);
  const map: Record<SecurityReferenceOutcome, ReferencePlanOutcome> = {
    AUTHORITATIVELY_RESOLVABLE: "authoritatively_resolvable", CONFLICTING: "conflicting",
    AMBIGUOUS: "ambiguous", UNSUPPORTED: "unsupported", NO_REFERENCE_AVAILABLE: "no_reference",
    PROVIDER_FAILED: "provider_failed", RATE_LIMITED: "rate_limited", PARTIAL_RESPONSE: "partial",
  };
  return { outcome: map[resolved.outcome], resolution: resolved };
}

/** Builds a stable plan regardless of supplied input order. */
export function buildInstitutionalSecurityReferencePlan(input: {
  population: readonly EligibleReferencePopulationRow[];
  trustedState: readonly TrustedReferenceState[];
  providerResolutions: readonly SecurityReferenceResolution[];
  maxCusips: number;
  /** Exact provider request set. Omitted only for pure callers with supplied resolutions. */
  plannedLookupCusips?: readonly string[];
}): InstitutionalSecurityReferencePlan {
  const maxCusips = Math.max(0, Math.floor(input.maxCusips));
  const states = new Map(input.trustedState.map(row => [normalizeCusip(row.cusip), row]));
  const resolutions = new Map(input.providerResolutions.map(row => [normalizeCusip(row.cusip), row]));
  const population = input.population.map(row => ({ ...row, cusip: normalizeCusip(row.cusip) ?? row.cusip.trim().toUpperCase() }))
    .sort((a, b) => a.cusip.localeCompare(b.cusip));
  const lookupEligible = population.filter(row => {
    const state = states.get(row.cusip) ?? { cusip: row.cusip, evidence: [] };
    return !state.blocked && !stateIsTrusted(state);
  });
  const requested = Array.from(new Set((input.plannedLookupCusips ?? input.providerResolutions.map(row => row.cusip))
    .map(normalizeCusip).filter((cusip): cusip is string => !!cusip)))
    .filter(cusip => lookupEligible.some(row => row.cusip === cusip)).sort().slice(0, maxCusips);
  // A malformed/truncated provider response remains a persisted partial
  // observation for every requested CUSIP, rather than disappearing silently.
  for (const cusip of requested) if (!resolutions.has(cusip)) {
    resolutions.set(cusip, resolveProviderSecurityReference(cusip, "PARTIAL_RESPONSE", [], { errorCode: "MISSING_PROVIDER_RESULT" }));
  }
  const assessed = population.map(row => {
    const state = states.get(row.cusip) ?? { cusip: row.cusip, evidence: [], trusted: false };
    return { row, ...planOutcome(resolutions.get(row.cusip), state) };
  });
  // Every observed provider resolution is persisted, including negative and
  // transport outcomes. Existing trusted state is already durable, so is not
  // emitted as an action.
  const eligibleActions = assessed.filter(item => {
    const state = states.get(item.row.cusip) ?? { cusip: item.row.cusip, evidence: [] };
    return !state.blocked && !stateIsTrusted(state) &&
      requested.includes(item.row.cusip);
  }).sort((a, b) => a.row.cusip.localeCompare(b.row.cusip));
  const actions: ReferencePlanAction[] = eligibleActions.slice(0, maxCusips).map(item => ({
    cusip: item.row.cusip, effectiveOutcome: item.resolution!.outcome, symbol: item.resolution!.symbol,
    promotable: item.outcome === "authoritatively_resolvable", resolution: item.resolution!,
  }));
  const alreadyTrusted = (row: EligibleReferencePopulationRow) => {
    const state = states.get(row.cusip) ?? { cusip: row.cusip, evidence: [] };
    return stateIsTrusted(state);
  };
  const before = percentValue(population, alreadyTrusted);
  const actionIds = new Set(actions.filter(action => action.promotable).map(action => action.cusip));
  const projected = percentValue(population, row => alreadyTrusted(row) || actionIds.has(row.cusip));
  const outcomes = outcomeOrder.map(outcome => {
    const rows = assessed.filter(item => item.outcome === outcome).map(item => item.row);
    return { outcome, ...percentValue(rows, () => true) };
  });
  const canonical = {
    version: 1 as const, maxCusips, before, projected, outcomes, actions,
    actionCounts: { requestedCusipLimit: maxCusips, plannedLookups: actions.length, plannedWrites: actions.length,
      promotable: actions.filter(action => action.promotable).length, skippedByLimit: lookupEligible.length - requested.length },
  };
  return { ...canonical, planHash: createHash("sha256").update(stableJson(canonical)).digest("hex") };
}

/** Deterministic, read-only provider request selector used before any network call. */
export function selectInstitutionalReferenceLookupCusips(input: {
  population: readonly EligibleReferencePopulationRow[]; trustedState: readonly TrustedReferenceState[]; maxCusips: number;
}): string[] {
  const states = new Map(input.trustedState.map(row => [normalizeCusip(row.cusip), row]));
  return Array.from(new Set(input.population.map(row => normalizeCusip(row.cusip)).filter((x): x is string => !!x)))
    .filter(cusip => {
      const state = states.get(cusip) ?? { cusip, evidence: [] };
      return !state.blocked && !stateIsTrusted(state);
    }).sort().slice(0, Math.max(0, Math.floor(input.maxCusips)));
}

/** Public CLI output intentionally excludes candidates, evidence, and errors. */
export function referencePlanAggregateSummary(plan: InstitutionalSecurityReferencePlan) {
  return { planHash: plan.planHash, before: plan.before, projected: plan.projected, outcomes: plan.outcomes, actionCounts: plan.actionCounts };
}

export function referenceApplyGuard(input: {
  apply: boolean; suppliedPlanHash?: string; planHash: string; maxCusips?: number;
  applyEnabled?: string; nodeEnv?: string; railwayEnvironment?: string;
}): string[] {
  if (!input.apply) return [];
  const failures: string[] = [];
  if (!input.suppliedPlanHash || input.suppliedPlanHash !== input.planHash) failures.push("FRESH_PLAN_HASH_REQUIRED");
  if (input.applyEnabled !== "true") failures.push("APPLY_NOT_ENABLED");
  if (!Number.isInteger(input.maxCusips) || (input.maxCusips ?? 0) < 0) failures.push("MAX_CUSIPS_REQUIRED");
  if (input.nodeEnv === "production" && input.railwayEnvironment !== "production") failures.push("RAILWAY_PRODUCTION_IDENTITY_REQUIRED");
  return failures;
}