/**
 * Deterministic, provider-neutral plan builder for population-wide 13F
 * reference enrichment.  It deliberately has no database, clock, or network
 * dependency: callers supply the complete eligible population and resolutions.
 */
import { createHash } from "node:crypto";
import {
  normalizeCusip, resolveReviewedSecurityReference, type SecurityReferenceEvidence,
  resolveProviderSecurityReference, type SecurityReferenceCandidate, type SecurityReferenceOutcome, type SecurityReferenceResolution,
} from "./security-reference-enrichment";
import {
  classifyInstitutionalSecurityType,
  type CanonicalInstitutionalSecurityType,
  type InstitutionalSecurityTypeClassification,
  type SecurityAnalyticsPopulation,
} from "./security-type-eligibility";
import { INSTITUTIONAL_SECURITY_TYPE_NORMALIZATION_VERSION } from "./security-type-eligibility";

export type ReferencePlanOutcome =
  | "authoritatively_resolvable" | "conflicting" | "ambiguous" | "unsupported"
  | "no_reference" | "provider_failed" | "rate_limited" | "partial"
  | "terminal_ambiguous" | "terminal_unsupported" | "terminal_no_reference"
  | "terminal_conflicting" | "retryable_other"
  /** No provider result was requested for this row in this cursor chunk. */
  | "not_processed";

export interface EligibleReferencePopulationRow {
  cusip: string;
  holdingRows: number;
  /** Aggregate reported value in USD text. Null means unavailable, not zero. */
  reportedValueUsd: string | null;
  /** Trusted symbols associated with this CUSIP, used only for type evidence matching. */
  trustedSymbols?: readonly string[];
  /** Current canonical type from security_master, when one is persisted. */
  currentAssetType?: string | null;
}
export interface TrustedReferenceState {
  cusip: string;
  evidence: readonly SecurityReferenceEvidence[];
  /** True only for a persisted exact/reviewed mapping already safe to use. */
  trusted?: boolean;
  /** A rejected local record is an explicit block on automated enrichment. */
  blocked?: boolean;
  /** Persisted provider observation, if this CUSIP has been looked up before. */
  lookupState?: PersistedReferenceLookupState;
  /** Candidate history is supporting evidence that the provider has been queried. */
  candidateHistoryPresent?: boolean;
  /** Current canonical type from security_master, when one is persisted. */
  currentAssetType?: string | null;
  /** Whether the current canonical type was manually reviewed. */
  assetTypeReviewed?: boolean;
  /** Current normalized provider candidates, if already persisted. */
  candidateEvidence?: readonly SecurityReferenceCandidate[];
}
export interface PersistedReferenceLookupState {
  providerOutcome?: string | null;
  outcome?: string | null;
  fingerprint?: string | null;
  currentCandidateCount?: number;
}
export interface ReferencePlanAction {
  cusip: string;
  /** Resolver-governed effective outcome retained with the provider observation. */
  effectiveOutcome: SecurityReferenceOutcome;
  symbol: string | null;
  promotable: boolean;
  resolution: SecurityReferenceResolution;
  /** True when this action fills a missing/stale type on a trusted identity. */
  assetTypeBackfill: boolean;
  /** Canonical type projected by this action, when authoritative evidence supports it. */
  assetType: CanonicalInstitutionalSecurityType | null;
}
export interface ReferenceCoverage {
  distinctCusips: number;
  holdingRows: number;
  knownReportedValueUsd: string | null;
  knownValueCusips: number;
}
export interface ReferenceOutcomeCount extends ReferenceCoverage { outcome: ReferencePlanOutcome; }
export interface ReferenceAttemptedOutcomeCount { outcome: Exclude<ReferencePlanOutcome, "not_processed">; count: number; }
export interface ReferenceSelectionCounts {
  asset_type_backfill: number;
  skipped_terminal_ambiguous: number;
  skipped_terminal_unsupported: number;
  skipped_terminal_no_reference: number;
  skipped_terminal_conflicting: number;
  retryable_provider_failed: number;
  retryable_rate_limited: number;
  retryable_other: number;
  never_processed: number;
}
export interface InstitutionalSecurityReferencePlan {
  version: 1;
  maxCusips: number;
  /** The exclusive, normalized CUSIP cursor used to select this chunk. */
  cursor: string | null;
  /** Final requested CUSIP; use as the exclusive continuation cursor. */
  nextCursor: string | null;
  before: ReferenceCoverage;
  projected: ReferenceCoverage;
  outcomes: ReferenceOutcomeCount[];
  /** Requested provider outcomes only; counts must sum exactly to plannedLookups. */
  attemptedOutcomes: ReferenceAttemptedOutcomeCount[];
  /** Population-level selection classifications used to explain skipped work. */
  selection: ReferenceSelectionCounts;
  /** Bounded, sorted persistence action set. This is exactly what is hashed. */
  actions: ReferencePlanAction[];
  actionCounts: {
    requestedCusipLimit: number; plannedLookups: number; plannedWrites: number; promotable: number;
    /** Eligible rows after the cursor which did not fit in this chunk. */
    skippedByLimit: number;
    /** Eligible rows at or before the exclusive cursor. */
    skippedByCursor: number;
    /** Total eligible rows not requested in this run. */
    notProcessed: number;
  };
  assetTypes: AssetTypeCoverageSummary;
  planHash: string;
}

export interface AssetTypeCoverageMetric {
  canonicalSecurityType: CanonicalInstitutionalSecurityType;
  securityTypePopulation: SecurityAnalyticsPopulation;
  distinctCusips: number;
  distinctSymbols: number;
  holdingRows: number;
  reportedValueUsd: string;
}

export interface AssetTypeCoverageSummary {
  trustedCusips: number;
  trustedSymbols: number;
  assetTypePopulated: number;
  assetTypeMissing: number;
  projectedAssetTypePopulated: number;
  projectedAssetTypeInsufficient: number;
  classifications: AssetTypeCoverageMetric[];
}

export interface AssetTypeCorrectionCoverage {
  trustedCusips: number;
  assetTypePopulated: number;
  stockEligibleCusips: number;
  separateFundCusips: number;
  unsupportedCusips: number;
  insufficientCusips: number;
}

export interface AssetTypeCorrectionAction {
  cusip: string;
  currentAssetType: string;
  projectedAssetType: CanonicalInstitutionalSecurityType;
  providerEvidence: string[];
  symbol: string | null;
  preservesTrustedIdentity: true;
}

export interface InstitutionalAssetTypeCorrectionPlan {
  version: 1;
  normalizationVersion: typeof INSTITUTIONAL_SECURITY_TYPE_NORMALIZATION_VERSION;
  before: AssetTypeCorrectionCoverage;
  projected: AssetTypeCorrectionCoverage;
  actions: AssetTypeCorrectionAction[];
  planHash: string;
}

const outcomeOrder: ReferencePlanOutcome[] = [
  "authoritatively_resolvable", "conflicting", "ambiguous", "unsupported",
  "no_reference", "provider_failed", "rate_limited", "partial",
  "terminal_ambiguous", "terminal_unsupported", "terminal_no_reference",
  "terminal_conflicting", "retryable_other", "not_processed",
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

function isPopulatedAssetType(classification: InstitutionalSecurityTypeClassification): boolean {
  return classification.analyticsPopulation !== "INSUFFICIENT_SECURITY_TYPE_EVIDENCE";
}

function currentAssetTypeClassification(
  row: EligibleReferencePopulationRow,
  state: TrustedReferenceState,
): InstitutionalSecurityTypeClassification {
  return classifyInstitutionalSecurityType({
    assetType: state.currentAssetType ?? row.currentAssetType,
  });
}

function providerAssetTypeClassification(
  row: EligibleReferencePopulationRow,
  state: TrustedReferenceState,
  resolution?: SecurityReferenceResolution,
): InstitutionalSecurityTypeClassification {
  const symbols = new Set([
    ...(row.trustedSymbols ?? []),
    ...state.evidence.map((item) => item.symbol ?? ""),
    ...(resolution?.symbol ? [resolution.symbol] : []),
  ].map((symbol) => symbol.trim().toUpperCase()).filter(Boolean));
  const candidates = (resolution?.candidates?.length ? resolution.candidates : state.candidateEvidence ?? [])
    .filter((candidate) =>
      symbols.size === 0 || symbols.has((candidate.ticker ?? "").trim().toUpperCase()),
    );
  const classifications = candidates
    .map((candidate) => classifyInstitutionalSecurityType(candidate))
    .filter(isPopulatedAssetType);
  const types = Array.from(new Set(classifications.map((classification) => classification.canonicalType)));
  if (types.length === 1) {
    return classifications.find((classification) => classification.canonicalType === types[0])!;
  }
  return {
    canonicalType: types.length > 1 ? "ambiguous" : "insufficient_evidence",
    analyticsPopulation: "INSUFFICIENT_SECURITY_TYPE_EVIDENCE",
    evidence: candidates.flatMap((candidate) =>
      classifyInstitutionalSecurityType(candidate).evidence,
    ),
  };
}

function assetTypeNeedsBackfill(
  row: EligibleReferencePopulationRow,
  state: TrustedReferenceState,
): boolean {
  // A reviewed identity with a non-null type is protected. A reviewed identity
  // with no type is intentionally still eligible: Task #197 closes that
  // coverage gap without replacing a human's existing type decision.
  if (state.assetTypeReviewed && (state.currentAssetType ?? row.currentAssetType) != null) return false;
  return !isPopulatedAssetType(currentAssetTypeClassification(row, state));
}

function projectedAssetTypeClassification(
  row: EligibleReferencePopulationRow,
  state: TrustedReferenceState,
  resolution?: SecurityReferenceResolution,
): InstitutionalSecurityTypeClassification {
  const current = currentAssetTypeClassification(row, state);
  return isPopulatedAssetType(current)
    ? current
    : providerAssetTypeClassification(row, state, resolution);
}

function normalizedSymbols(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))).sort();
}

function stateIsTrusted(state: TrustedReferenceState): boolean {
  // A repository may provide an already-resolved trusted-state bit, but any
  // supplied evidence takes precedence so contradictory exact/reviewed records
  // can never be counted merely because one SQL row was trusted.
  if (state.blocked) return false;
  return state.evidence.length === 0 ? state.trusted === true :
    resolveReviewedSecurityReference(state.cusip, state.evidence).outcome === "AUTHORITATIVELY_RESOLVABLE";
}

export function assetTypeCoverageSummary(
  population: readonly EligibleReferencePopulationRow[],
  trustedState: readonly TrustedReferenceState[],
  providerResolutions: readonly SecurityReferenceResolution[] = [],
): AssetTypeCoverageSummary {
  const states = new Map(trustedState.map((state) => [normalizeCusip(state.cusip), state]));
  const resolutions = new Map(providerResolutions.map((resolution) => [normalizeCusip(resolution.cusip), resolution]));
  const groups = new Map<string, {
    type: CanonicalInstitutionalSecurityType;
    population: SecurityAnalyticsPopulation;
    cusips: Set<string>;
    symbols: Set<string>;
    holdingRows: number;
    reportedValueUsd: bigint;
  }>();
  let trustedCusips = 0;
  const trustedSymbols = new Set<string>();
  let assetTypePopulated = 0;
  let assetTypeMissing = 0;
  let projectedAssetTypePopulated = 0;
  let projectedAssetTypeInsufficient = 0;

  for (const row of population) {
    const normalizedCusip = normalizeCusip(row.cusip);
    const state = states.get(normalizedCusip) ?? { cusip: row.cusip, evidence: [] };
    if (!stateIsTrusted(state)) continue;
    trustedCusips++;
    const symbols = normalizedSymbols([
      ...(row.trustedSymbols ?? []),
      ...state.evidence.map((item) => item.symbol ?? ""),
    ]);
    symbols.forEach((symbol) => trustedSymbols.add(symbol));
    const current = currentAssetTypeClassification(row, state);
    const projected = projectedAssetTypeClassification(
      row,
      state,
      resolutions.get(normalizedCusip),
    );
    if (isPopulatedAssetType(current)) assetTypePopulated++;
    else assetTypeMissing++;
    if (isPopulatedAssetType(projected)) projectedAssetTypePopulated++;
    else projectedAssetTypeInsufficient++;
    const key = `${projected.canonicalType}:${projected.analyticsPopulation}`;
    const group = groups.get(key) ?? {
      type: projected.canonicalType,
      population: projected.analyticsPopulation,
      cusips: new Set<string>(),
      symbols: new Set<string>(),
      holdingRows: 0,
      reportedValueUsd: BigInt(0),
    };
    group.cusips.add(row.cusip);
    symbols.forEach((symbol) => group.symbols.add(symbol));
    group.holdingRows += row.holdingRows;
    if (row.reportedValueUsd !== null) {
      group.reportedValueUsd += BigInt(String(row.reportedValueUsd));
    }
    groups.set(key, group);
  }

  return {
    trustedCusips,
    trustedSymbols: trustedSymbols.size,
    assetTypePopulated,
    assetTypeMissing,
    projectedAssetTypePopulated,
    projectedAssetTypeInsufficient,
    classifications: Array.from(groups.values())
      .sort((a, b) => a.type.localeCompare(b.type) || a.population.localeCompare(b.population))
      .map((group) => ({
        canonicalSecurityType: group.type,
        securityTypePopulation: group.population,
        distinctCusips: group.cusips.size,
        distinctSymbols: group.symbols.size,
        holdingRows: group.holdingRows,
        reportedValueUsd: group.reportedValueUsd.toString(),
      })),
  };
}

function correctionCoverage(
  rows: readonly EligibleReferencePopulationRow[],
  states: ReadonlyMap<string | null, TrustedReferenceState>,
  resolutions: ReadonlyMap<string | null, SecurityReferenceResolution>,
  projected: boolean,
): AssetTypeCorrectionCoverage {
  const result: AssetTypeCorrectionCoverage = {
    trustedCusips: 0, assetTypePopulated: 0, stockEligibleCusips: 0,
    separateFundCusips: 0, unsupportedCusips: 0, insufficientCusips: 0,
  };
  for (const row of rows) {
    const state = states.get(normalizeCusip(row.cusip)) ?? { cusip: row.cusip, evidence: [] };
    if (!stateIsTrusted(state)) continue;
    result.trustedCusips++;
    const current = currentAssetTypeClassification(row, state);
    const provider = providerAssetTypeClassification(row, state, resolutions.get(normalizeCusip(row.cusip)));
    const classification = projected && !state.assetTypeReviewed && isPopulatedAssetType(provider)
      ? provider
      : current;
    if (isPopulatedAssetType(classification)) result.assetTypePopulated++;
    if (classification.analyticsPopulation === "ELIGIBLE_STOCK_ANALYTICS") result.stockEligibleCusips++;
    else if (classification.analyticsPopulation === "ELIGIBLE_BUT_SEPARATE_FUND_ANALYTICS") result.separateFundCusips++;
    else if (classification.analyticsPopulation === "UNSUPPORTED_FOR_STOCK_ANALYTICS") result.unsupportedCusips++;
    else result.insufficientCusips++;
  }
  return result;
}

/**
 * Builds a read-only correction artifact for machine-derived persisted types.
 * It never changes identity mappings and intentionally has no APPLY companion.
 */
export function buildInstitutionalAssetTypeCorrectionPlan(input: {
  population: readonly EligibleReferencePopulationRow[];
  trustedState: readonly TrustedReferenceState[];
  providerResolutions?: readonly SecurityReferenceResolution[];
}): InstitutionalAssetTypeCorrectionPlan {
  const states = new Map(input.trustedState.map((state) => [normalizeCusip(state.cusip), state]));
  const resolutions = new Map((input.providerResolutions ?? []).map((resolution) => [normalizeCusip(resolution.cusip), resolution]));
  const actions = input.population
    .map((row) => {
      const state = states.get(normalizeCusip(row.cusip)) ?? { cusip: row.cusip, evidence: [] };
      if (!stateIsTrusted(state) || state.assetTypeReviewed) return null;
      const currentValue = state.currentAssetType ?? row.currentAssetType;
      if (!currentValue?.trim()) return null;
      const current = currentAssetTypeClassification(row, state);
      const provider = providerAssetTypeClassification(row, state, resolutions.get(normalizeCusip(row.cusip)));
      if (!isPopulatedAssetType(provider) || current.canonicalType === provider.canonicalType) return null;
      const providerEvidence = provider.evidence.length > 0
        ? [...provider.evidence].sort()
        : ["provider_classification"];
      const symbol = [...(row.trustedSymbols ?? []), ...state.evidence.map((item) => item.symbol ?? "")]
        .map((value) => value.trim().toUpperCase()).find(Boolean) ?? null;
      return {
        cusip: row.cusip,
        currentAssetType: currentValue.trim(),
        projectedAssetType: provider.canonicalType,
        providerEvidence,
        symbol,
        preservesTrustedIdentity: true as const,
      };
    })
    .filter((action): action is AssetTypeCorrectionAction => action !== null)
    .sort((a, b) => a.cusip.localeCompare(b.cusip));
  const before = correctionCoverage(input.population, states, resolutions, false);
  const projected = correctionCoverage(input.population, states, resolutions, true);
  const canonical = {
    version: 1 as const,
    normalizationVersion: INSTITUTIONAL_SECURITY_TYPE_NORMALIZATION_VERSION,
    before,
    projected,
    actions,
    population: input.population.map((row) => ({
      cusip: normalizeCusip(row.cusip) ?? row.cusip.trim().toUpperCase(),
      currentAssetType: row.currentAssetType ?? null,
    })).sort((a, b) => a.cusip.localeCompare(b.cusip)),
  };
  return {
    ...canonical,
    planHash: createHash("sha256").update(stableJson(canonical)).digest("hex"),
  };
}

type ReferenceSelectionKind = "protected" | "never_processed" | "retryable_provider_failed"
  | "retryable_rate_limited" | "retryable_other" | "terminal_ambiguous"
  | "terminal_unsupported" | "terminal_no_reference" | "terminal_conflicting";

function normalizedPersistedOutcome(state: TrustedReferenceState): string | null {
  const value = state.lookupState?.outcome ?? state.lookupState?.providerOutcome;
  if (!value) return null;
  return value.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function referenceSelectionKind(state: TrustedReferenceState): ReferenceSelectionKind {
  if (state.blocked || stateIsTrusted(state)) return "protected";
  if (!state.lookupState && !state.candidateHistoryPresent) return "never_processed";
  switch (normalizedPersistedOutcome(state)) {
    case "AMBIGUOUS": return "terminal_ambiguous";
    case "UNSUPPORTED": return "terminal_unsupported";
    case "NO_REFERENCE":
    case "NO_REFERENCE_AVAILABLE": return "terminal_no_reference";
    case "CONFLICTING": return "terminal_conflicting";
    case "PROVIDER_FAILED": return "retryable_provider_failed";
    case "RATE_LIMITED": return "retryable_rate_limited";
    case "PARTIAL":
    case "PARTIAL_RESPONSE": return "retryable_other";
    default: return "retryable_other";
  }
}

function terminalPlanOutcome(state: TrustedReferenceState): ReferencePlanOutcome | null {
  const kind = referenceSelectionKind(state);
  return kind === "terminal_ambiguous" || kind === "terminal_unsupported"
    || kind === "terminal_no_reference" || kind === "terminal_conflicting" ? kind : null;
}

function planOutcome(
  resolution: SecurityReferenceResolution | undefined,
  state: TrustedReferenceState,
  requested: boolean,
  refreshTerminal: boolean,
): { outcome: ReferencePlanOutcome; resolution?: SecurityReferenceResolution } {
  if (state.blocked) return { outcome: "unsupported" };
  // Never trust a SQL status flag alone: Task #189 resolves conflicting
  // reviewed/exact evidence before it can count toward current coverage.
  if (stateIsTrusted(state)) {
    return {
      outcome: "authoritatively_resolvable",
      resolution: resolution ?? (state.candidateEvidence?.length
        ? resolveReviewedSecurityReference(state.cusip, state.evidence, state.candidateEvidence)
        : undefined),
    };
  }
  const terminal = terminalPlanOutcome(state);
  if (!requested && terminal && !refreshTerminal) return { outcome: terminal };
  // PARTIAL_RESPONSE describes a requested, incomplete provider response. It
  // must never be used to conceal work deliberately excluded by a chunk bound.
  if (!requested) return { outcome: "not_processed" };
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
  cursor?: string | null;
  /** Exact provider request set. Omitted only for pure callers with supplied resolutions. */
  plannedLookupCusips?: readonly string[];
  /** Explicitly re-query terminal unresolved outcomes. Defaults to false. */
  refreshTerminal?: boolean;
  /** Include trusted identities whose canonical asset type is missing/stale. */
  includeAssetTypeBackfill?: boolean;
}): InstitutionalSecurityReferencePlan {
  const maxCusips = Math.max(0, Math.floor(input.maxCusips));
  const refreshTerminal = input.refreshTerminal === true;
  const cursor = input.cursor == null ? null : normalizeCusip(input.cursor);
  if (input.cursor != null && !cursor) throw new Error("INVALID_CUSIP_CURSOR");
  const states = new Map(input.trustedState.map(row => [normalizeCusip(row.cusip), row]));
  const resolutions = new Map(input.providerResolutions.map(row => [normalizeCusip(row.cusip), row]));
  const population = input.population.map(row => ({ ...row, cusip: normalizeCusip(row.cusip) ?? row.cusip.trim().toUpperCase() }))
    .sort((a, b) => a.cusip.localeCompare(b.cusip));
  const lookupEligible = population.filter(row => {
    const state = states.get(row.cusip) ?? { cusip: row.cusip, evidence: [] };
    return !state.blocked && !stateIsTrusted(state);
  });
  const assetTypeLookupEligible = input.includeAssetTypeBackfill
    ? population.filter((row) => {
      const state = states.get(row.cusip) ?? { cusip: row.cusip, evidence: [] };
      return !state.blocked && stateIsTrusted(state) && assetTypeNeedsBackfill(row, state);
    })
    : [];
  const selected = selectInstitutionalReferenceLookupCusips({
    population, trustedState: input.trustedState, maxCusips, cursor, refreshTerminal,
    includeAssetTypeBackfill: input.includeAssetTypeBackfill,
  });
  const requested = Array.from(new Set((input.plannedLookupCusips ?? selected)
    .map(normalizeCusip).filter((cusip): cusip is string => !!cusip)))
    .filter(cusip => selected.includes(cusip)).sort();
  // A malformed/truncated provider response remains a persisted partial
  // observation for every requested CUSIP, rather than disappearing silently.
  for (const cusip of requested) if (!resolutions.has(cusip)) {
    const state = states.get(cusip);
    if (state?.candidateEvidence?.length) {
      resolutions.set(cusip, resolveReviewedSecurityReference(
        cusip,
        state.evidence,
        state.candidateEvidence,
      ));
    } else {
      resolutions.set(cusip, resolveProviderSecurityReference(cusip, "PARTIAL_RESPONSE", [], { errorCode: "MISSING_PROVIDER_RESULT" }));
    }
  }
  const assessed = population.map(row => {
    const state = states.get(row.cusip) ?? { cusip: row.cusip, evidence: [], trusted: false };
    return { row, ...planOutcome(resolutions.get(row.cusip), state, requested.includes(row.cusip), refreshTerminal) };
  });
  // Every observed provider resolution is persisted, including negative and
  // transport outcomes. Existing trusted state is already durable, so is not
  // emitted as an action.
  const eligibleActions = assessed.filter(item => {
    const state = states.get(item.row.cusip) ?? { cusip: item.row.cusip, evidence: [] };
    const trustedAssetTypeBackfill = stateIsTrusted(state) &&
      assetTypeNeedsBackfill(item.row, state);
    return !state.blocked && (!stateIsTrusted(state) || trustedAssetTypeBackfill) &&
      requested.includes(item.row.cusip);
  }).sort((a, b) => a.row.cusip.localeCompare(b.row.cusip));
  const actions: ReferencePlanAction[] = eligibleActions.slice(0, maxCusips).map(item => {
    const state = states.get(item.row.cusip) ?? { cusip: item.row.cusip, evidence: [] };
    const assetTypeBackfill = stateIsTrusted(state) && assetTypeNeedsBackfill(item.row, state);
    const projectedAssetType = projectedAssetTypeClassification(item.row, state, item.resolution);
    const assetType = isPopulatedAssetType(projectedAssetType)
      ? projectedAssetType.canonicalType
      : null;
    return {
      cusip: item.row.cusip,
      effectiveOutcome: item.resolution!.outcome,
      symbol: item.resolution!.symbol,
      promotable: assetTypeBackfill ? assetType !== null : item.outcome === "authoritatively_resolvable",
      resolution: item.resolution!,
      assetTypeBackfill,
      assetType,
    };
  });
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
  const attemptedOutcomes = outcomeOrder.filter(
    (outcome): outcome is Exclude<ReferencePlanOutcome, "not_processed"> => outcome !== "not_processed",
  ).map(outcome => ({
    outcome,
    count: assessed.filter(item => requested.includes(item.row.cusip) && item.outcome === outcome).length,
  }));
  const selection = lookupEligible.reduce<ReferenceSelectionCounts>((counts, row) => {
    const state = states.get(row.cusip) ?? { cusip: row.cusip, evidence: [] };
    const kind = referenceSelectionKind(state);
    if (kind === "terminal_ambiguous" && !refreshTerminal) counts.skipped_terminal_ambiguous++;
    if (kind === "terminal_unsupported" && !refreshTerminal) counts.skipped_terminal_unsupported++;
    if (kind === "terminal_no_reference" && !refreshTerminal) counts.skipped_terminal_no_reference++;
    if (kind === "terminal_conflicting" && !refreshTerminal) counts.skipped_terminal_conflicting++;
    if (kind === "retryable_provider_failed") counts.retryable_provider_failed++;
    if (kind === "retryable_rate_limited") counts.retryable_rate_limited++;
    if (kind === "retryable_other") counts.retryable_other++;
    if (kind === "never_processed") counts.never_processed++;
    return counts;
  }, {
    asset_type_backfill: assetTypeLookupEligible.length,
    skipped_terminal_ambiguous: 0,
    skipped_terminal_unsupported: 0,
    skipped_terminal_no_reference: 0,
    skipped_terminal_conflicting: 0,
    retryable_provider_failed: 0,
    retryable_rate_limited: 0,
    retryable_other: 0,
    never_processed: 0,
  });
  const policyEligible = [...lookupEligible, ...assetTypeLookupEligible].filter(row => {
    const state = states.get(row.cusip) ?? { cusip: row.cusip, evidence: [] };
    return refreshTerminal || !terminalPlanOutcome(state);
  });
  const assetTypes = assetTypeCoverageSummary(
    population,
    input.trustedState,
    Array.from(resolutions.values()),
  );
  const canonical = {
    // Include the complete normalized population plus the exact requested
    // CUSIPs and provider observations. Thus a hash cannot be reused for a
    // different population, cursor/chunk, or provider result set.
    version: 1 as const, maxCusips, cursor, refreshTerminal,
    includeAssetTypeBackfill: input.includeAssetTypeBackfill === true,
    nextCursor: requested.at(-1) ?? null, before, projected, outcomes, attemptedOutcomes, selection, actions, assetTypes,
    population,
    requestedLookupCusips: requested,
    providerResults: requested.map(cusip => resolutions.get(cusip)!),
    actionCounts: { requestedCusipLimit: maxCusips, plannedLookups: actions.length, plannedWrites: actions.length,
      promotable: actions.filter(action => action.promotable).length,
      skippedByLimit: policyEligible.filter(row => (!cursor || row.cusip > cursor) && !requested.includes(row.cusip)).length,
      skippedByCursor: [...lookupEligible, ...assetTypeLookupEligible].filter(row => !!cursor && row.cusip <= cursor).length,
      notProcessed: [...lookupEligible, ...assetTypeLookupEligible].length - requested.length },
  };
  const { population: _population, requestedLookupCusips: _requested, providerResults: _providerResults, ...plan } = canonical;
  return { ...plan, planHash: createHash("sha256").update(stableJson(canonical)).digest("hex") };
}

/** Deterministic, read-only provider request selector used before any network call. */
export function selectInstitutionalReferenceLookupCusips(input: {
  population: readonly EligibleReferencePopulationRow[]; trustedState: readonly TrustedReferenceState[]; maxCusips: number;
  /** Exclusive cursor: a continuation starts strictly after this CUSIP. */
  cursor?: string | null;
  /** Explicitly include terminal unresolved outcomes. */
  refreshTerminal?: boolean;
  /** Include trusted identities whose canonical asset type is missing/stale. */
  includeAssetTypeBackfill?: boolean;
}): string[] {
  const cursor = input.cursor == null ? null : normalizeCusip(input.cursor);
  if (input.cursor != null && !cursor) throw new Error("INVALID_CUSIP_CURSOR");
  const states = new Map(input.trustedState.map(row => [normalizeCusip(row.cusip), row]));
  const population = new Map(input.population.map((row) => [normalizeCusip(row.cusip), row]));
  const refreshTerminal = input.refreshTerminal === true;
  return Array.from(new Set(input.population.map(row => normalizeCusip(row.cusip)).filter((x): x is string => !!x)))
    .filter(cusip => {
      const state = states.get(cusip) ?? { cusip, evidence: [] };
      const row = population.get(cusip)!;
      return !state.blocked && (
        !stateIsTrusted(state) ||
        (input.includeAssetTypeBackfill === true && assetTypeNeedsBackfill(row, state))
      );
    }).filter(cusip => !cursor || cusip > cursor)
    .filter(cusip => {
      const state = states.get(cusip) ?? { cusip, evidence: [] };
      return stateIsTrusted(state) || refreshTerminal || !terminalPlanOutcome(state);
    })
    .sort((a, b) => {
      const aState = states.get(a) ?? { cusip: a, evidence: [] };
      const bState = states.get(b) ?? { cusip: b, evidence: [] };
      const aRow = population.get(a);
      const bRow = population.get(b);
      const priority = (kind: ReferenceSelectionKind) =>
        kind === "never_processed" ? 1 : kind === "retryable_provider_failed"
          || kind === "retryable_rate_limited" || kind === "retryable_other" ? 2 : 3;
      // A trusted identity missing its canonical type is the purpose of this
      // bounded run. It must outrank historical retry noise, regardless of
      // whether cached candidates exist. Cached sufficient evidence is still
      // reused later and does not consume a provider request.
      const aAssetTypeBackfill = !!aRow && stateIsTrusted(aState) && assetTypeNeedsBackfill(aRow, aState);
      const bAssetTypeBackfill = !!bRow && stateIsTrusted(bState) && assetTypeNeedsBackfill(bRow, bState);
      const aPriority = aAssetTypeBackfill ? 0 : priority(referenceSelectionKind(aState));
      const bPriority = bAssetTypeBackfill ? 0 : priority(referenceSelectionKind(bState));
      return aPriority - bPriority
        || a.localeCompare(b);
    }).slice(0, Math.max(0, Math.floor(input.maxCusips)));
}

/** Public CLI output intentionally excludes candidates, evidence, and errors. */
export function referencePlanAggregateSummary(plan: InstitutionalSecurityReferencePlan) {
  return {
    planHash: plan.planHash,
    before: plan.before,
    projected: plan.projected,
    outcomes: plan.outcomes,
    selection: plan.selection,
    actionCounts: plan.actionCounts,
    assetTypes: plan.assetTypes,
  };
}
/** Safe dry-run continuation metadata; nextCursor is the only disclosed CUSIP. */
export function referencePlanChunkSummary(plan: InstitutionalSecurityReferencePlan) {
  return {
    cursor: plan.cursor, nextCursor: plan.nextCursor, requested: plan.actionCounts.plannedLookups,
    hasMore: plan.actionCounts.skippedByLimit > 0, skippedByLimit: plan.actionCounts.skippedByLimit,
    skippedByCursor: plan.actionCounts.skippedByCursor,
  };
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
