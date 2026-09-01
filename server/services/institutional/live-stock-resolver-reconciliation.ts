import {
  evaluateStockCandidateIdentity,
  type StockCandidateCanonicalRow,
  type StockCandidateEvidenceRow,
} from "./analytics/stock-candidate-identity";

export interface LiveStockSecurityMasterRow extends StockCandidateCanonicalRow {
  ticker: string | null;
}

export interface LiveStockEvidenceRow extends StockCandidateEvidenceRow {
  accessionNumber: string;
  periodOfReport: string;
}

export interface LiveStockPresenceRow {
  symbol: string;
  periodOfReport?: string | null;
}

export interface LiveStockResolverReconciliationInput {
  canonicalIdentities: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
  securityMasterRows: readonly LiveStockSecurityMasterRow[];
  evidenceRows: readonly LiveStockEvidenceRow[];
  selectedAccessionsBySymbol?: Readonly<Record<string, readonly string[]>>;
  aggregateRows: readonly LiveStockPresenceRow[];
  signalSymbols: readonly string[];
  runtimeCommit: string | null;
  expectedCommit: string | null;
  runtimeDatabase: string;
  expectedDatabase: string | null;
  runtimeSchema: string;
  analyzerDatabase: string;
  analyzerSchema: string;
  performance?: {
    runtimeMs: number;
    queryCount: number;
    maxQueryMs: number;
    timedOut: boolean;
  };
}

export interface LiveStockResolverMismatch {
  symbol: string;
  canonicalCusips: string[];
  candidateCusips: string[];
  reason: string;
}

export interface LiveStockResolverReconciliationReport {
  performance: {
    runtimeMs: number;
    queryCount: number;
    maxQueryMs: number;
    timedOut: boolean;
  };
  metadata: {
    runningCommit: string | null;
    expectedCommit: string | null;
    sameCommit: boolean;
    runtimeDatabaseName: string;
    expectedDatabaseName: string | null;
    runtimeDatabaseMatchesExpected: boolean;
    runtimeSchemaName: string;
    analyzerDatabaseName: string;
    analyzerSchemaName: string;
    sameDatabaseIdentity: boolean;
  };
  counts: {
    canonicalStockEligibleCusips: number;
    canonicalStockEligibleSymbols: number;
    liveResolverResolvableSymbols: number;
    liveResolverUnresolvableCanonicalSymbols: number;
    aggregateBackedSymbols: number;
    signalBackedSymbols: number;
    aggregateBackedButLiveUnresolvable: number;
    signalBackedButLiveUnresolvable: number;
    trustedMappingSymbols: number;
    securityMasterTickerSymbols: number;
    mappingOnlyCanonicalSymbols: number;
    directSecurityMasterSymbols: number;
    malformedSymbols: number;
    identitySetMismatches: number;
  };
  firstDivergencePoint:
    | "NONE"
    | "RUNNING_COMMIT"
    | "RUNTIME_DATABASE"
    | "ANALYZER_DATABASE"
    | "SYMBOL_NORMALIZATION"
    | "CUSIP_IDENTITY_SET"
    | "LIVE_IDENTITY_RESOLVER";
  liveResolverReconciled: boolean;
  /** Backward-compatible summary alias. */
  reconciled: boolean;
  mismatchSamples: LiveStockResolverMismatch[];
}

function identitiesOf(
  input: LiveStockResolverReconciliationInput["canonicalIdentities"],
): Array<[string, string]> {
  return (input instanceof Map ? Array.from(input.entries()) : Object.entries(input))
    .map(([cusip, symbol]): [string, string] => [
      cusip.trim().toUpperCase(),
      symbol.trim().toUpperCase(),
    ])
    .filter(([cusip, symbol]) => Boolean(cusip && symbol));
}

/** Exact validity contract enforced by the live Stock View route. */
export const isValidLiveStockSymbol = (symbol: string) =>
  /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol);

/**
 * Report-only comparison of canonical identities with the exact live Stock
 * View gate. Aggregate and signal rows are compared only after identity
 * evaluation and never participate as resolver evidence.
 */
export function reconcileLiveStockResolver(
  input: LiveStockResolverReconciliationInput,
): LiveStockResolverReconciliationReport {
  const identities = identitiesOf(input.canonicalIdentities);
  const canonicalBySymbol = new Map<string, string[]>();
  for (const [cusip, symbol] of identities) {
    canonicalBySymbol.set(symbol, [...(canonicalBySymbol.get(symbol) ?? []), cusip]);
  }
  const symbols = Array.from(canonicalBySymbol.keys()).sort();
  const accepted = new Set<string>();
  const identitySetMismatches = new Set<string>();
  const trustedMappingSymbols = new Set<string>();
  const securityMasterTickerSymbols = new Set<string>();
  const directSecurityMasterSymbols = new Set<string>();
  const mappingOnlyCanonicalSymbols = new Set<string>();
  const mismatches: LiveStockResolverMismatch[] = [];

  for (const symbol of symbols) {
    // This is the same target predicate as loadStockCandidateIdentity's SQL.
    const matches = (value: string | null | undefined) =>
      value?.trim().toUpperCase() === symbol;
    const canonicalRows = input.securityMasterRows.filter((row) => matches(row.ticker));
    const selectedAccessions = input.selectedAccessionsBySymbol?.[symbol];
    const evidenceRows = input.evidenceRows.filter((row) =>
      (!selectedAccessions || selectedAccessions.includes(row.accessionNumber)) &&
      (matches(row.masterTicker) ||
        matches(row.mappingSymbol) ||
        matches(row.holdingMappedSymbol))
    );
    const directMaster = canonicalRows.some((row) =>
      row.reviewStatus === "reviewed" &&
      (row.assetType === "common_stock" || row.assetType === "reit")
    );
    const trustedMapping = evidenceRows.some((row) =>
      matches(row.mappingSymbol) &&
      ["exact", "reviewed"].includes(row.mappingStatus?.trim().toLowerCase() ?? "")
    );
    if (canonicalRows.length > 0) securityMasterTickerSymbols.add(symbol);
    if (directMaster) directSecurityMasterSymbols.add(symbol);
    if (trustedMapping) trustedMappingSymbols.add(symbol);
    if (trustedMapping && !directMaster) mappingOnlyCanonicalSymbols.add(symbol);
    const result = evaluateStockCandidateIdentity(symbol, canonicalRows, evidenceRows);
    const canonicalCusips = Array.from(new Set(canonicalBySymbol.get(symbol) ?? [])).sort();
    const candidateCusips = Array.from(new Set(result.candidateCusips)).sort();
    const identitySetMatches =
      canonicalCusips.length === candidateCusips.length &&
      canonicalCusips.every((cusip, index) => cusip === candidateCusips[index]);
    if (!identitySetMatches) {
      identitySetMismatches.add(symbol);
      mismatches.push({
        symbol,
        canonicalCusips,
        candidateCusips,
        reason: "IDENTITY_SET_MISMATCH",
      });
    }
    const valid = isValidLiveStockSymbol(symbol);
    if (!valid) {
      mismatches.push({
        symbol,
        canonicalCusips,
        candidateCusips,
        reason: "MALFORMED_SYMBOL",
      });
    }
    if (
      valid &&
      identitySetMatches &&
      result.hasReliableSecurityIdentity &&
      !result.hasDisqualifyingCandidateEvidence
    ) {
      accepted.add(symbol);
    } else {
      if (!result.hasReliableSecurityIdentity || result.hasDisqualifyingCandidateEvidence) {
        mismatches.push({
          symbol,
          canonicalCusips,
          candidateCusips,
          reason: result.hasDisqualifyingCandidateEvidence
            ? "DISQUALIFYING_EVIDENCE"
            : "UNRESOLVED",
        });
      }
    }
  }

  const aggregate = new Set(input.aggregateRows.map((row) => row.symbol.trim().toUpperCase()).filter(Boolean));
  const signal = new Set(input.signalSymbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean));
  const canonical = new Set(symbols);
  const unresolvable = symbols.filter((symbol) => !accepted.has(symbol));
  const aggregateBacked = symbols.filter((symbol) => aggregate.has(symbol));
  const signalBacked = symbols.filter((symbol) => signal.has(symbol));
  const aggregateBackedUnresolvable =
    aggregateBacked.filter((symbol) => !accepted.has(symbol));
  const signalBackedUnresolvable =
    signalBacked.filter((symbol) => !accepted.has(symbol));

  const sameCommit = Boolean(input.expectedCommit) &&
    input.runtimeCommit === input.expectedCommit;
  const runtimeDatabaseMatchesExpected = Boolean(input.expectedDatabase) &&
    input.runtimeDatabase === input.expectedDatabase;
  const sameDatabaseIdentity =
    input.runtimeDatabase === input.analyzerDatabase &&
    input.runtimeSchema === input.analyzerSchema;
  const malformedSymbols =
    symbols.filter((symbol) => !isValidLiveStockSymbol(symbol)).length;
  const liveResolverReconciled =
    !input.performance?.timedOut &&
    sameCommit &&
    runtimeDatabaseMatchesExpected &&
    sameDatabaseIdentity &&
    unresolvable.length === 0 &&
    identitySetMismatches.size === 0 &&
    malformedSymbols === 0;
  const firstDivergencePoint =
    !sameCommit ? "RUNNING_COMMIT" as const
      : !runtimeDatabaseMatchesExpected ? "RUNTIME_DATABASE" as const
        : !sameDatabaseIdentity ? "ANALYZER_DATABASE" as const
          : malformedSymbols > 0 ? "SYMBOL_NORMALIZATION" as const
            : identitySetMismatches.size > 0 ? "CUSIP_IDENTITY_SET" as const
              : unresolvable.length > 0 ? "LIVE_IDENTITY_RESOLVER" as const
                : "NONE" as const;
  return {
    performance: input.performance ?? {
      runtimeMs: 0,
      queryCount: 0,
      maxQueryMs: 0,
      timedOut: false,
    },
    metadata: {
      runningCommit: input.runtimeCommit,
      expectedCommit: input.expectedCommit,
      sameCommit,
      runtimeDatabaseName: input.runtimeDatabase,
      expectedDatabaseName: input.expectedDatabase,
      runtimeDatabaseMatchesExpected,
      runtimeSchemaName: input.runtimeSchema,
      analyzerDatabaseName: input.analyzerDatabase,
      analyzerSchemaName: input.analyzerSchema,
      sameDatabaseIdentity,
    },
    counts: {
      canonicalStockEligibleCusips: identities.length,
      canonicalStockEligibleSymbols: canonical.size,
      liveResolverResolvableSymbols: accepted.size,
      liveResolverUnresolvableCanonicalSymbols: unresolvable.length,
      aggregateBackedSymbols: aggregateBacked.length,
      signalBackedSymbols: signalBacked.length,
      aggregateBackedButLiveUnresolvable: aggregateBackedUnresolvable.length,
      signalBackedButLiveUnresolvable: signalBackedUnresolvable.length,
      trustedMappingSymbols: trustedMappingSymbols.size,
      securityMasterTickerSymbols: securityMasterTickerSymbols.size,
      mappingOnlyCanonicalSymbols: mappingOnlyCanonicalSymbols.size,
      directSecurityMasterSymbols: directSecurityMasterSymbols.size,
      malformedSymbols,
      identitySetMismatches: identitySetMismatches.size,
    },
    firstDivergencePoint,
    liveResolverReconciled,
    reconciled: liveResolverReconciled,
    mismatchSamples: mismatches
      .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.reason.localeCompare(b.reason))
      .slice(0, 10),
  };
}