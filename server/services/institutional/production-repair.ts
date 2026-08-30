import { createHash } from "node:crypto";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const INSTITUTIONAL_REPAIR_CONFIRMATION = "REPAIR_INSTITUTIONAL_PRODUCTION_DATA";
export const INSTITUTIONAL_REPAIR_LOCK_KEY = 774_412_004;
export const MAX_NEAR_ZERO_MAPPING_COVERAGE = 0.05;

export const VERIFIED_REPAIR_MAPPINGS = [
  { symbol: "AAPL", cusip: "037833100", issuerName: "Apple Inc." },
  { symbol: "NVDA", cusip: "67066G104", issuerName: "NVIDIA Corporation" },
  { symbol: "MSFT", cusip: "594918104", issuerName: "Microsoft Corporation" },
  { symbol: "COST", cusip: "22160K105", issuerName: "Costco Wholesale Corporation" },
] as const;

export type RepairStage = "mapping" | "aggregates" | "signals" | "snapshots" | "validation";
export const REPAIR_STAGE_ORDER: RepairStage[] = [
  "mapping",
  "aggregates",
  "signals",
  "snapshots",
  "validation",
];

type SqlExecutor = {
  execute(query: unknown): Promise<unknown>;
};

export interface ExpectedSecurityTrace {
  symbol: string;
  cusip: string;
  issuerNames: string[];
  effectiveHoldingRows: number;
  mappedHoldingRows: number;
  conflictingHoldingRows: number;
  issuerIdentityMatched: boolean;
  referenceSymbol: string | null;
  referenceStatus: string | null;
  mappingAction: "insert_reviewed" | "promote_reviewed" | "already_reliable" | "conflict";
}

export interface InstitutionalRepairPreflight {
  databaseIdentity: {
    database: string;
    user: string;
    schema: string;
    railwayEnvironment: string | null;
  };
  schemaReady: boolean;
  publicFeatureEnabled: boolean;
  duplicateHoldingGroups: number;
  orphanHoldingRows: number;
  mappingCounts: Record<string, number>;
  dataQuality: {
    totalFilings: number;
    effectiveFilings: number;
    totalHoldings: number;
    effectiveHoldings: number;
    effectiveManagers: number;
    effectiveQuarters: number;
    latestEffectiveQuarter: string | null;
    mappedEffectiveHoldings: number;
    mappingCoverage: number | null;
    aggregateRows: number;
    aggregateState: "incomplete" | "present";
  };
  expectedSecurities: ExpectedSecurityTrace[];
  plan: {
    effectiveHoldings: number;
    reliableMappingCandidates: number;
    mappingRowsToInsert: number;
    mappingRowsToPromote: number;
    ambiguousMappings: number;
    unmappedMappings: number;
    rejectedMappings: number;
    alreadyMappedEffectiveHoldings: number;
    holdingsToUpdate: number;
    remainingUnmappedEffectiveHoldings: number;
    conflictingMappedHoldings: number;
    aggregateSymbols: number;
    aggregateQuarters: number;
    aggregateRowsToInsert: number;
    aggregateRowsToUpdate: number;
    signalRowsToInsert: number;
    signalRowsToUpdate: number;
    reliableMappingDigest: string;
    targetHoldingDigest: string;
  };
  blockingIssues: string[];
  planHash: string;
}

export interface MappingApplyResult {
  planHash: string;
  mappingsInsertedOrPromoted: number;
  holdingsUpdated: number;
  remainingTargetHoldings: number;
}

function rowsOf(result: unknown): any[] {
  const candidate = result as { rows?: any[] };
  return candidate.rows ?? (Array.isArray(result) ? result : []);
}

function asCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function buildInstitutionalRepairPlanHash(
  input: Omit<InstitutionalRepairPreflight, "planHash" | "blockingIssues">,
): string {
  return createHash("sha256").update(stableJson(input)).digest("hex");
}

export function validateRepairApplyRequest(input: {
  apply: boolean;
  confirmation?: string | null;
  environment?: string | null;
  railwayEnvironment?: string | null;
  publicFeatureEnabled?: boolean;
  expectedDatabase?: string | null;
  currentDatabase?: string | null;
}): string[] {
  if (!input.apply) return [];
  const issues: string[] = [];
  if (input.confirmation !== INSTITUTIONAL_REPAIR_CONFIRMATION) {
    issues.push("CONFIRMATION_PHRASE_MISMATCH");
  }
  if (input.environment !== "production") {
    issues.push("PRODUCTION_ENVIRONMENT_ARGUMENT_REQUIRED");
  }
  if (!input.railwayEnvironment || input.railwayEnvironment.toLowerCase() !== "production") {
    issues.push("RAILWAY_ENVIRONMENT_IS_NOT_PRODUCTION");
  }
  if (!input.expectedDatabase) {
    issues.push("EXPECTED_DATABASE_NAME_REQUIRED");
  } else if (input.expectedDatabase !== input.currentDatabase) {
    issues.push("DATABASE_IDENTITY_MISMATCH");
  }
  if (input.publicFeatureEnabled) {
    issues.push("PUBLIC_FEATURE_MUST_REMAIN_DISABLED");
  }
  return issues;
}

export function classifyExpectedSecurityTrace(input: {
  symbol: string;
  effectiveHoldingRows: number;
  conflictingHoldingRows: number;
  referenceSymbol: string | null;
  referenceStatus: string | null;
}): ExpectedSecurityTrace["mappingAction"] {
  if (
    input.conflictingHoldingRows > 0 ||
    (input.referenceSymbol !== null && input.referenceSymbol !== input.symbol)
  ) {
    return "conflict";
  }
  if (input.referenceSymbol === null) return "insert_reviewed";
  if (input.referenceStatus === "exact" || input.referenceStatus === "reviewed") {
    return "already_reliable";
  }
  return "promote_reviewed";
}

export function issuerNamesMatchExpectedSymbol(symbol: string, issuerNames: string[]): boolean {
  const keywordBySymbol: Record<string, string> = {
    AAPL: "APPLE",
    NVDA: "NVIDIA",
    MSFT: "MICROSOFT",
    COST: "COSTCO",
  };
  const keyword = keywordBySymbol[symbol];
  return Boolean(keyword && issuerNames.some((name) => name.toUpperCase().includes(keyword)));
}

export function shouldRunRepairStage(stage: RepairStage, fromStage: RepairStage): boolean {
  return REPAIR_STAGE_ORDER.indexOf(stage) >= REPAIR_STAGE_ORDER.indexOf(fromStage);
}

export function getRepairStageBlockingIssues(
  preflight: InstitutionalRepairPreflight,
  fromStage: RepairStage,
): string[] {
  if (
    (fromStage === "mapping" || fromStage === "aggregates") &&
    preflight.dataQuality.aggregateState !== "incomplete"
  ) {
    return ["AGGREGATE_STATE_NOT_INCOMPLETE"];
  }
  return [];
}

export function getRepairBlockingIssues(
  preflight: Omit<InstitutionalRepairPreflight, "blockingIssues" | "planHash">,
): string[] {
  const issues: string[] = [];
  if (!preflight.schemaReady) issues.push("INSTITUTIONAL_SCHEMA_MISSING_OR_INCOMPATIBLE");
  if (preflight.publicFeatureEnabled) issues.push("PUBLIC_FEATURE_MUST_REMAIN_DISABLED");
  if (preflight.duplicateHoldingGroups > 0) issues.push("DUPLICATE_HOLDING_GROUPS_PRESENT");
  if (preflight.orphanHoldingRows > 0) issues.push("ORPHAN_HOLDINGS_PRESENT");
  if (preflight.dataQuality.effectiveFilings === 0) {
    issues.push("NO_EFFECTIVE_FILINGS");
  }
  if (preflight.dataQuality.effectiveManagers === 0) {
    issues.push("NO_EFFECTIVE_MANAGERS");
  }
  if (preflight.dataQuality.effectiveQuarters < 2) {
    issues.push("INSUFFICIENT_HISTORICAL_QUARTERS");
  }
  if (preflight.dataQuality.effectiveHoldings === 0) {
    issues.push("NO_EFFECTIVE_HOLDINGS");
  }
  if (
    preflight.dataQuality.mappingCoverage !== null &&
    preflight.dataQuality.mappingCoverage > MAX_NEAR_ZERO_MAPPING_COVERAGE
  ) {
    issues.push("MAPPING_COVERAGE_NOT_NEAR_ZERO");
  }
  for (const trace of preflight.expectedSecurities) {
    if (trace.effectiveHoldingRows === 0) issues.push(`EXPECTED_CUSIP_NOT_PRESENT:${trace.symbol}`);
    if (trace.effectiveHoldingRows > 0 && !trace.issuerIdentityMatched) {
      issues.push(`EXPECTED_CUSIP_ISSUER_MISMATCH:${trace.symbol}`);
    }
    if (trace.mappingAction === "conflict") issues.push(`EXPECTED_CUSIP_CONFLICT:${trace.symbol}`);
  }
  if (preflight.plan.conflictingMappedHoldings > 0) {
    issues.push("CONFLICTING_EXISTING_HOLDING_MAPPINGS");
  }
  return issues;
}

export async function loadInstitutionalRepairPreflight(
  executor: SqlExecutor = db as unknown as SqlExecutor,
): Promise<InstitutionalRepairPreflight> {
  const identityRows = rowsOf(await executor.execute(sql`
    SELECT
      current_database() AS database,
      current_user AS "user",
      current_schema() AS schema
  `));
  const identity = identityRows[0] ?? {};

  const schemaRows = rowsOf(await executor.execute(sql`
    SELECT
      to_regclass('public.institutional_13f_filings') IS NOT NULL
      AND to_regclass('public.institutional_13f_holdings') IS NOT NULL
      AND to_regclass('public.institutional_security_mappings') IS NOT NULL
      AND to_regclass('public.institutional_quarterly_aggregates') IS NOT NULL
      AND to_regclass('public.institutional_symbol_signals') IS NOT NULL
      AND to_regclass('public.sector_intelligence_snapshots') IS NOT NULL
      AND to_regclass('public.theme_intelligence_snapshots') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM (
          VALUES
            ('institutional_13f_filings', 'accession_number'),
            ('institutional_13f_filings', 'is_effective'),
            ('institutional_13f_holdings', 'id'),
            ('institutional_13f_holdings', 'cusip'),
            ('institutional_13f_holdings', 'mapped_symbol'),
            ('institutional_13f_holdings', 'mapping_status'),
            ('institutional_security_mappings', 'cusip'),
            ('institutional_security_mappings', 'mapped_symbol'),
            ('institutional_security_mappings', 'mapping_status'),
            ('institutional_quarterly_aggregates', 'prev_period_of_report'),
            ('institutional_symbol_signals', 'calculated_at'),
            ('sector_intelligence_snapshots', 'generated_at'),
            ('theme_intelligence_snapshots', 'generated_at')
        ) AS required(table_name, column_name)
        LEFT JOIN information_schema.columns c
          ON c.table_schema = 'public'
         AND c.table_name = required.table_name
         AND c.column_name = required.column_name
        WHERE c.column_name IS NULL
      )
        AS ready
  `));
  const schemaReady = schemaRows[0]?.ready === true;

  if (!schemaReady) {
    const base = {
      databaseIdentity: {
        database: String(identity.database ?? "unknown"),
        user: String(identity.user ?? "unknown"),
        schema: String(identity.schema ?? "unknown"),
        railwayEnvironment: process.env.RAILWAY_ENVIRONMENT_NAME ?? null,
      },
      schemaReady: false,
      publicFeatureEnabled: process.env.INSTITUTIONAL_INTELLIGENCE_ENABLED === "true",
      duplicateHoldingGroups: 0,
      orphanHoldingRows: 0,
      mappingCounts: {},
      dataQuality: {
        totalFilings: 0,
        effectiveFilings: 0,
        totalHoldings: 0,
        effectiveHoldings: 0,
        effectiveManagers: 0,
        effectiveQuarters: 0,
        latestEffectiveQuarter: null,
        mappedEffectiveHoldings: 0,
        mappingCoverage: null,
        aggregateRows: 0,
        aggregateState: "incomplete" as const,
      },
      expectedSecurities: VERIFIED_REPAIR_MAPPINGS.map((mapping) => ({
        ...mapping,
        issuerNames: [],
        effectiveHoldingRows: 0,
        mappedHoldingRows: 0,
        conflictingHoldingRows: 0,
        issuerIdentityMatched: false,
        referenceSymbol: null,
        referenceStatus: null,
        mappingAction: "insert_reviewed" as const,
      })),
      plan: {
        effectiveHoldings: 0,
        reliableMappingCandidates: 0,
        mappingRowsToInsert: 0,
        mappingRowsToPromote: 0,
        ambiguousMappings: 0,
        unmappedMappings: 0,
        rejectedMappings: 0,
        alreadyMappedEffectiveHoldings: 0,
        holdingsToUpdate: 0,
        remainingUnmappedEffectiveHoldings: 0,
        conflictingMappedHoldings: 0,
        aggregateSymbols: 0,
        aggregateQuarters: 0,
        aggregateRowsToInsert: 0,
        aggregateRowsToUpdate: 0,
        signalRowsToInsert: 0,
        signalRowsToUpdate: 0,
        reliableMappingDigest: "",
        targetHoldingDigest: "",
      },
    };
    const blockingIssues = getRepairBlockingIssues(base);
    return { ...base, blockingIssues, planHash: buildInstitutionalRepairPlanHash(base) };
  }

  const expectedCusips = VERIFIED_REPAIR_MAPPINGS.map((mapping) => mapping.cusip);
  const traceRows = rowsOf(await executor.execute(sql`
    WITH effective_holdings AS (
      SELECT h.*
      FROM institutional_13f_holdings h
      INNER JOIN institutional_13f_filings f
        ON f.accession_number = h.accession_number
       AND f.is_effective = TRUE
    )
    SELECT
      h.cusip,
      ARRAY_AGG(DISTINCT h.issuer_name ORDER BY h.issuer_name) AS issuer_names,
      COUNT(*)::int AS effective_holding_rows,
      COUNT(*) FILTER (WHERE h.mapped_symbol IS NOT NULL)::int AS mapped_holding_rows,
      COUNT(*) FILTER (
        WHERE h.mapped_symbol IS NOT NULL
          AND h.mapped_symbol <> CASE h.cusip
            WHEN '037833100' THEN 'AAPL'
            WHEN '67066G104' THEN 'NVDA'
            WHEN '594918104' THEN 'MSFT'
            WHEN '22160K105' THEN 'COST'
          END
      )::int AS conflicting_holding_rows,
      MAX(m.mapped_symbol) AS reference_symbol,
      MAX(m.mapping_status) AS reference_status
    FROM effective_holdings h
    LEFT JOIN institutional_security_mappings m ON m.cusip = h.cusip
    WHERE h.cusip IN (${sql.join(expectedCusips.map((cusip) => sql`${cusip}`), sql`, `)})
    GROUP BY h.cusip
  `));
  const traceByCusip = new Map(traceRows.map((row) => [row.cusip, row]));
  const expectedSecurities: ExpectedSecurityTrace[] = VERIFIED_REPAIR_MAPPINGS.map((mapping) => {
    const row = traceByCusip.get(mapping.cusip) ?? {};
    const trace = {
      symbol: mapping.symbol,
      cusip: mapping.cusip,
      issuerNames: Array.isArray(row.issuer_names) ? row.issuer_names.map(String).slice(0, 10) : [],
      effectiveHoldingRows: asCount(row.effective_holding_rows),
      mappedHoldingRows: asCount(row.mapped_holding_rows),
      conflictingHoldingRows: asCount(row.conflicting_holding_rows),
      referenceSymbol: row.reference_symbol ? String(row.reference_symbol) : null,
      referenceStatus: row.reference_status ? String(row.reference_status) : null,
      issuerIdentityMatched: issuerNamesMatchExpectedSymbol(
        mapping.symbol,
        Array.isArray(row.issuer_names) ? row.issuer_names.map(String) : [],
      ),
    };
    return { ...trace, mappingAction: classifyExpectedSecurityTrace(trace) };
  });

  const duplicateRows = rowsOf(await executor.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM (
      SELECT accession_number, cusip, class_title, COALESCE(put_call, '')
      FROM institutional_13f_holdings
      GROUP BY accession_number, cusip, class_title, COALESCE(put_call, '')
      HAVING COUNT(*) > 1
    ) duplicates
  `));
  const orphanRows = rowsOf(await executor.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM institutional_13f_holdings h
    LEFT JOIN institutional_13f_filings f ON f.accession_number = h.accession_number
    WHERE f.accession_number IS NULL
  `));
  const mappingRows = rowsOf(await executor.execute(sql`
    SELECT mapping_status, COUNT(*)::int AS count
    FROM institutional_security_mappings
    GROUP BY mapping_status
  `));
  const mappingCounts = Object.fromEntries(
    mappingRows.map((row) => [String(row.mapping_status), asCount(row.count)]),
  );
  const qualityRows = rowsOf(await executor.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM institutional_13f_filings) AS total_filings,
      (SELECT COUNT(*)::int FROM institutional_13f_filings WHERE is_effective = TRUE) AS effective_filings,
      (SELECT COUNT(*)::int FROM institutional_13f_holdings) AS total_holdings,
      (SELECT COUNT(*)::int
         FROM institutional_13f_holdings h
         INNER JOIN institutional_13f_filings f
           ON f.accession_number = h.accession_number
          AND f.is_effective = TRUE) AS effective_holdings,
      (SELECT COUNT(DISTINCT h.filer_cik)::int
         FROM institutional_13f_holdings h
         INNER JOIN institutional_13f_filings f
           ON f.accession_number = h.accession_number
          AND f.is_effective = TRUE) AS effective_managers,
      (SELECT COUNT(DISTINCT h.period_of_report)::int
         FROM institutional_13f_holdings h
         INNER JOIN institutional_13f_filings f
           ON f.accession_number = h.accession_number
          AND f.is_effective = TRUE) AS effective_quarters,
      (SELECT MAX(h.period_of_report)
         FROM institutional_13f_holdings h
         INNER JOIN institutional_13f_filings f
           ON f.accession_number = h.accession_number
          AND f.is_effective = TRUE) AS latest_effective_quarter,
      (SELECT COUNT(*)::int
         FROM institutional_13f_holdings h
         INNER JOIN institutional_13f_filings f
           ON f.accession_number = h.accession_number
          AND f.is_effective = TRUE
        WHERE h.mapped_symbol IS NOT NULL
          AND h.mapping_status IN ('exact', 'reviewed')) AS mapped_effective_holdings,
      (SELECT COUNT(*)::int FROM institutional_quarterly_aggregates) AS aggregate_rows
  `));
  const qualityRow = qualityRows[0] ?? {};
  const effectiveHoldings = asCount(qualityRow.effective_holdings);
  const aggregateRows = asCount(qualityRow.aggregate_rows);
  const dataQuality = {
    totalFilings: asCount(qualityRow.total_filings),
    effectiveFilings: asCount(qualityRow.effective_filings),
    totalHoldings: asCount(qualityRow.total_holdings),
    effectiveHoldings,
    effectiveManagers: asCount(qualityRow.effective_managers),
    effectiveQuarters: asCount(qualityRow.effective_quarters),
    latestEffectiveQuarter: qualityRow.latest_effective_quarter
      ? String(qualityRow.latest_effective_quarter)
      : null,
    mappedEffectiveHoldings: asCount(qualityRow.mapped_effective_holdings),
    mappingCoverage: effectiveHoldings > 0
      ? asCount(qualityRow.mapped_effective_holdings) / effectiveHoldings
      : null,
    aggregateRows,
    aggregateState: aggregateRows === 0 ? "incomplete" as const : "present" as const,
  };

  const planRows = rowsOf(await executor.execute(sql`
    WITH verified(cusip, mapped_symbol, mapping_status) AS (
      VALUES
        ('037833100', 'AAPL', 'reviewed'),
        ('67066G104', 'NVDA', 'reviewed'),
        ('594918104', 'MSFT', 'reviewed'),
        ('22160K105', 'COST', 'reviewed')
    ),
    reliable AS (
      SELECT v.cusip, v.mapped_symbol, v.mapping_status
      FROM verified v
    ),
    effective_holdings AS (
      SELECT h.*
      FROM institutional_13f_holdings h
      INNER JOIN institutional_13f_filings f
        ON f.accession_number = h.accession_number
       AND f.is_effective = TRUE
    ),
    target AS (
      SELECT h.*, r.mapped_symbol AS target_symbol, r.mapping_status AS target_status
      FROM effective_holdings h
      INNER JOIN reliable r ON r.cusip = h.cusip
    ),
    target_quarters AS (
      SELECT DISTINCT target_symbol, period_of_report
      FROM target
    ),
    target_symbols AS (
      SELECT DISTINCT target_symbol
      FROM target
    )
    SELECT
      (SELECT COUNT(*) FROM effective_holdings)::int AS effective_holdings,
      (SELECT COUNT(*) FROM reliable)::int AS reliable_mapping_candidates,
      (SELECT MD5(COALESCE(STRING_AGG(
        cusip || '|' || mapped_symbol || '|' || mapping_status,
        ',' ORDER BY cusip
      ), '')) FROM reliable) AS reliable_mapping_digest,
      (SELECT COUNT(*) FROM target
        WHERE mapped_symbol = target_symbol AND mapping_status IN ('exact', 'reviewed'))::int
        AS already_mapped_effective_holdings,
      (SELECT COUNT(*) FROM target
        WHERE (mapped_symbol IS NULL OR mapped_symbol = target_symbol)
          AND (mapped_symbol IS NULL OR mapping_status NOT IN ('exact', 'reviewed')))::int
        AS holdings_to_update,
      (SELECT COUNT(*)
         FROM effective_holdings h
         LEFT JOIN reliable r ON r.cusip = h.cusip
        WHERE r.cusip IS NULL)::int AS remaining_unmapped_effective_holdings,
      (SELECT COUNT(*) FROM target
        WHERE mapped_symbol IS NOT NULL AND mapped_symbol <> target_symbol)::int
        AS conflicting_mapped_holdings,
      (SELECT COUNT(DISTINCT target_symbol) FROM target)::int AS aggregate_symbols,
      (SELECT COUNT(DISTINCT (target_symbol, period_of_report)) FROM target)::int AS aggregate_quarters,
      (SELECT COUNT(*)::int
         FROM target_quarters tq
         LEFT JOIN institutional_quarterly_aggregates a
           ON a.symbol = tq.target_symbol
          AND a.period_of_report = tq.period_of_report
        WHERE a.symbol IS NULL) AS aggregate_rows_to_insert,
      (SELECT COUNT(*)::int
         FROM target_quarters tq
         INNER JOIN institutional_quarterly_aggregates a
           ON a.symbol = tq.target_symbol
          AND a.period_of_report = tq.period_of_report) AS aggregate_rows_to_update,
      (SELECT COUNT(*)::int
         FROM target_symbols ts
         LEFT JOIN institutional_symbol_signals s ON s.symbol = ts.target_symbol
        WHERE s.symbol IS NULL) AS signal_rows_to_insert,
      (SELECT COUNT(*)::int
         FROM target_symbols ts
         INNER JOIN institutional_symbol_signals s ON s.symbol = ts.target_symbol) AS signal_rows_to_update,
      (SELECT MD5(COALESCE(STRING_AGG(
        id || '|' || cusip || '|' || COALESCE(mapped_symbol, '') || '|' ||
        mapping_status || '|' || target_symbol || '|' || target_status,
        ',' ORDER BY id
      ), '')) FROM target) AS target_holding_digest
  `));
  const planRow = planRows[0] ?? {};

  const base = {
    databaseIdentity: {
      database: String(identity.database ?? "unknown"),
      user: String(identity.user ?? "unknown"),
      schema: String(identity.schema ?? "unknown"),
      railwayEnvironment: process.env.RAILWAY_ENVIRONMENT_NAME ?? null,
    },
    schemaReady,
    publicFeatureEnabled: process.env.INSTITUTIONAL_INTELLIGENCE_ENABLED === "true",
    duplicateHoldingGroups: asCount(duplicateRows[0]?.count),
    orphanHoldingRows: asCount(orphanRows[0]?.count),
    mappingCounts,
    dataQuality: {
      ...dataQuality,
      aggregateState: asCount(planRow.aggregate_rows_to_insert) > 0
        ? "incomplete" as const
        : "present" as const,
    },
    expectedSecurities,
    plan: {
      effectiveHoldings: asCount(planRow.effective_holdings),
      reliableMappingCandidates: asCount(planRow.reliable_mapping_candidates),
      mappingRowsToInsert: expectedSecurities.filter(
        (trace) => trace.mappingAction === "insert_reviewed",
      ).length,
      mappingRowsToPromote: expectedSecurities.filter(
        (trace) => trace.mappingAction === "promote_reviewed",
      ).length,
      ambiguousMappings: mappingCounts.ambiguous ?? 0,
      unmappedMappings: mappingCounts.unmapped ?? 0,
      rejectedMappings: mappingCounts.rejected ?? 0,
      alreadyMappedEffectiveHoldings: asCount(planRow.already_mapped_effective_holdings),
      holdingsToUpdate: asCount(planRow.holdings_to_update),
      remainingUnmappedEffectiveHoldings: asCount(planRow.remaining_unmapped_effective_holdings),
      conflictingMappedHoldings: asCount(planRow.conflicting_mapped_holdings),
      aggregateSymbols: asCount(planRow.aggregate_symbols),
      aggregateQuarters: asCount(planRow.aggregate_quarters),
      aggregateRowsToInsert: asCount(planRow.aggregate_rows_to_insert),
      aggregateRowsToUpdate: asCount(planRow.aggregate_rows_to_update),
      signalRowsToInsert: asCount(planRow.signal_rows_to_insert),
      signalRowsToUpdate: asCount(planRow.signal_rows_to_update),
      reliableMappingDigest: String(planRow.reliable_mapping_digest ?? ""),
      targetHoldingDigest: String(planRow.target_holding_digest ?? ""),
    },
  };
  const blockingIssues = getRepairBlockingIssues(base);
  return { ...base, blockingIssues, planHash: buildInstitutionalRepairPlanHash(base) };
}

export async function applyInstitutionalMappingRepair(
  expectedPlanHash: string,
): Promise<MappingApplyResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
    const lockRows = rowsOf(await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(${INSTITUTIONAL_REPAIR_LOCK_KEY}::bigint) AS locked`,
    ));
    if (lockRows[0]?.locked !== true) throw new Error("INSTITUTIONAL_REPAIR_LOCK_HELD");

    const preflight = await loadInstitutionalRepairPreflight(tx as unknown as SqlExecutor);
    if (preflight.planHash !== expectedPlanHash) throw new Error("INSTITUTIONAL_REPAIR_PLAN_DRIFT");
    if (preflight.blockingIssues.length > 0) {
      throw new Error(`INSTITUTIONAL_REPAIR_PREFLIGHT_FAILED:${preflight.blockingIssues.join(",")}`);
    }

    let mappingsInsertedOrPromoted = 0;
    for (const mapping of VERIFIED_REPAIR_MAPPINGS) {
      const result = rowsOf(await tx.execute(sql`
        INSERT INTO institutional_security_mappings
          (cusip, issuer_name, class_title, mapped_symbol, mapping_status, mapping_method, notes)
        VALUES (
          ${mapping.cusip},
          ${mapping.issuerName},
          'COM',
          ${mapping.symbol},
          'reviewed',
          'manual',
          'Verified production repair mapping'
        )
        ON CONFLICT (cusip) DO UPDATE SET
          issuer_name = COALESCE(institutional_security_mappings.issuer_name, EXCLUDED.issuer_name),
          mapped_symbol = EXCLUDED.mapped_symbol,
          mapping_status = 'reviewed',
          mapping_method = 'manual',
          last_verified_at = NOW(),
          notes = EXCLUDED.notes
        WHERE institutional_security_mappings.mapped_symbol = EXCLUDED.mapped_symbol
          AND institutional_security_mappings.mapping_status NOT IN ('exact', 'reviewed')
        RETURNING cusip
      `));
      mappingsInsertedOrPromoted += result.length;
    }

    const updateRows = rowsOf(await tx.execute(sql`
      WITH verified(cusip) AS (
        VALUES ('037833100'), ('67066G104'), ('594918104'), ('22160K105')
      ),
      updated AS (
        UPDATE institutional_13f_holdings h
        SET
          mapped_symbol = m.mapped_symbol,
          mapping_status = m.mapping_status
        FROM institutional_security_mappings m, institutional_13f_filings f
        WHERE f.accession_number = h.accession_number
          AND f.is_effective = TRUE
          AND m.cusip = h.cusip
          AND h.cusip IN (SELECT cusip FROM verified)
          AND m.mapped_symbol IS NOT NULL
          AND m.mapping_status IN ('exact', 'reviewed')
          AND (h.mapped_symbol IS NULL OR h.mapped_symbol = m.mapped_symbol)
          AND (h.mapped_symbol IS NULL OR h.mapping_status NOT IN ('exact', 'reviewed'))
        RETURNING h.id
      )
      SELECT COUNT(*)::int AS count FROM updated
    `));
    const holdingsUpdated = asCount(updateRows[0]?.count);

    const remainingRows = rowsOf(await tx.execute(sql`
      WITH verified(cusip) AS (
        VALUES ('037833100'), ('67066G104'), ('594918104'), ('22160K105')
      )
      SELECT COUNT(*)::int AS count
      FROM institutional_13f_holdings h
      INNER JOIN institutional_13f_filings f
        ON f.accession_number = h.accession_number
       AND f.is_effective = TRUE
      INNER JOIN institutional_security_mappings m ON m.cusip = h.cusip
      WHERE h.cusip IN (SELECT cusip FROM verified)
        AND m.mapped_symbol IS NOT NULL
        AND m.mapping_status IN ('exact', 'reviewed')
        AND (h.mapped_symbol IS NULL OR h.mapping_status NOT IN ('exact', 'reviewed'))
    `));
    const remainingTargetHoldings = asCount(remainingRows[0]?.count);
    if (remainingTargetHoldings > 0) throw new Error("INSTITUTIONAL_REPAIR_MAPPING_VALIDATION_FAILED");

    return {
      planHash: expectedPlanHash,
      mappingsInsertedOrPromoted,
      holdingsUpdated,
      remainingTargetHoldings,
    };
  });
}

export async function listReliableMappedSymbols(): Promise<string[]> {
  const result = await db.execute(sql`
    SELECT DISTINCT h.mapped_symbol AS symbol
    FROM institutional_13f_holdings h
    INNER JOIN institutional_13f_filings f
      ON f.accession_number = h.accession_number
     AND f.is_effective = TRUE
    WHERE h.mapped_symbol IS NOT NULL
      AND h.mapping_status IN ('exact', 'reviewed')
    ORDER BY h.mapped_symbol
  `);
  return rowsOf(result).map((row) => String(row.symbol)).filter(Boolean);
}

export async function validateInstitutionalRepairSymbols(): Promise<{
  symbols: any[];
  snapshots: {
    sectorRows: number;
    latestSectorGeneratedAt: string | null;
    themeRows: number;
    latestThemeGeneratedAt: string | null;
  };
  invalidComparableRows: number;
}> {
  const result = await db.execute(sql`
    WITH requested(symbol, cusip) AS (
      VALUES
        ('AAPL', '037833100'),
        ('NVDA', '67066G104'),
        ('MSFT', '594918104'),
        ('COST', '22160K105')
    ),
    effective AS (
      SELECT h.*
      FROM institutional_13f_holdings h
      INNER JOIN institutional_13f_filings f
        ON f.accession_number = h.accession_number
       AND f.is_effective = TRUE
    ),
    holding_stats AS (
      SELECT
        r.symbol,
        COUNT(*)::int AS holding_rows,
        COUNT(*) FILTER (
          WHERE h.mapped_symbol = r.symbol
            AND h.mapping_status IN ('exact', 'reviewed')
        )::int AS reliably_mapped_rows,
        COUNT(DISTINCT h.filer_cik)::int AS managers,
        COUNT(DISTINCT h.period_of_report)::int AS quarters,
        COUNT(*) FILTER (WHERE h.put_call IS NOT NULL OR h.shares_prn_type = 'PRN')::int AS excluded_option_or_prn
      FROM effective h
      INNER JOIN requested r ON r.cusip = h.cusip
      GROUP BY r.symbol
    ),
    aggregate_stats AS (
      SELECT
        symbol,
        COUNT(*)::int AS aggregate_rows,
        COUNT(DISTINCT period_of_report)::int AS aggregate_quarters,
        MAX(generated_at) AS latest_aggregate_at,
        MAX(reporting_manager_count)::int AS max_managers,
        SUM(new_position_count)::int AS new_positions,
        SUM(increased_position_count)::int AS increased_positions,
        SUM(reduced_position_count)::int AS reduced_positions,
        SUM(exited_position_count)::int AS exited_positions,
        COUNT(*) FILTER (
          WHERE prev_period_of_report IS NOT NULL
            AND prev_period_of_report <> (DATE_TRUNC('quarter', period_of_report)::date - 1)
        )::int AS invalid_comparable_rows
      FROM institutional_quarterly_aggregates
      WHERE symbol IN ('AAPL', 'NVDA', 'MSFT', 'COST')
      GROUP BY symbol
    )
    SELECT
      r.symbol,
      r.cusip,
      m.mapped_symbol AS reference_symbol,
      m.mapping_status AS reference_status,
      COALESCE(h.holding_rows, 0) AS holding_rows,
      COALESCE(h.reliably_mapped_rows, 0) AS reliably_mapped_rows,
      CASE
        WHEN COALESCE(h.holding_rows, 0) = 0 THEN NULL
        ELSE ROUND(h.reliably_mapped_rows::numeric / h.holding_rows, 4)
      END AS mapping_coverage,
      COALESCE(h.managers, 0) AS managers,
      COALESCE(h.quarters, 0) AS holding_quarters,
      COALESCE(h.excluded_option_or_prn, 0) AS excluded_option_or_prn,
      COALESCE(a.aggregate_rows, 0) AS aggregate_rows,
      COALESCE(a.aggregate_quarters, 0) AS aggregate_quarters,
      a.latest_aggregate_at,
      COALESCE(a.max_managers, 0) AS max_managers,
      COALESCE(a.new_positions, 0) AS new_positions,
      COALESCE(a.increased_positions, 0) AS increased_positions,
      COALESCE(a.reduced_positions, 0) AS reduced_positions,
      COALESCE(a.exited_positions, 0) AS exited_positions,
      COALESCE(a.invalid_comparable_rows, 0) AS invalid_comparable_rows,
      s.status AS signal_status,
      s.label AS signal_label,
      s.latest_quarter AS signal_latest_quarter,
      s.previous_quarter AS signal_previous_quarter,
      s.calculated_at AS signal_calculated_at
    FROM requested r
    LEFT JOIN institutional_security_mappings m ON m.cusip = r.cusip
    LEFT JOIN holding_stats h ON h.symbol = r.symbol
    LEFT JOIN aggregate_stats a ON a.symbol = r.symbol
    LEFT JOIN institutional_symbol_signals s ON s.symbol = r.symbol
    ORDER BY r.symbol
  `);
  const snapshotResult = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM sector_intelligence_snapshots)::int AS sector_rows,
      (SELECT MAX(generated_at) FROM sector_intelligence_snapshots) AS latest_sector_generated_at,
      (SELECT COUNT(*) FROM theme_intelligence_snapshots)::int AS theme_rows,
      (SELECT MAX(generated_at) FROM theme_intelligence_snapshots) AS latest_theme_generated_at
  `);
  const snapshot = rowsOf(snapshotResult)[0] ?? {};
  return {
    symbols: rowsOf(result),
    snapshots: {
      sectorRows: asCount(snapshot.sector_rows),
      latestSectorGeneratedAt: snapshot.latest_sector_generated_at
        ? new Date(snapshot.latest_sector_generated_at).toISOString()
        : null,
      themeRows: asCount(snapshot.theme_rows),
      latestThemeGeneratedAt: snapshot.latest_theme_generated_at
        ? new Date(snapshot.latest_theme_generated_at).toISOString()
        : null,
    },
    invalidComparableRows: rowsOf(result).reduce(
      (sum, row) => sum + asCount(row.invalid_comparable_rows),
      0,
    ),
  };
}

export function evaluateInstitutionalRepairValidation(
  validation: Awaited<ReturnType<typeof validateInstitutionalRepairSymbols>>,
  opts: { repairStartedAt: string; snapshotsRequired: boolean },
): string[] {
  const issues: string[] = [];
  const repairStartedAt = Date.parse(opts.repairStartedAt);
  for (const row of validation.symbols) {
    const symbol = String(row.symbol);
    if (row.reference_symbol !== symbol || !["exact", "reviewed"].includes(String(row.reference_status))) {
      issues.push(`VALIDATION_MAPPING_NOT_RELIABLE:${symbol}`);
    }
    if (asCount(row.holding_rows) === 0) issues.push(`VALIDATION_NO_HOLDINGS:${symbol}`);
    if (asCount(row.reliably_mapped_rows) !== asCount(row.holding_rows)) {
      issues.push(`VALIDATION_MAPPING_COVERAGE_INCOMPLETE:${symbol}`);
    }
    if (asCount(row.aggregate_quarters) < 2) issues.push(`VALIDATION_COMPARABLE_QUARTERS_MISSING:${symbol}`);
    if (!row.latest_aggregate_at || Date.parse(String(row.latest_aggregate_at)) < repairStartedAt) {
      issues.push(`VALIDATION_AGGREGATE_NOT_REBUILT:${symbol}`);
    }
    if (row.signal_status !== "available") issues.push(`VALIDATION_SIGNAL_NOT_AVAILABLE:${symbol}`);
    if (!row.signal_calculated_at || Date.parse(String(row.signal_calculated_at)) < repairStartedAt) {
      issues.push(`VALIDATION_SIGNAL_NOT_REBUILT:${symbol}`);
    }
  }
  if (validation.invalidComparableRows > 0) issues.push("VALIDATION_INVALID_QUARTER_COMPARISONS");
  if (opts.snapshotsRequired) {
    if (
      validation.snapshots.sectorRows === 0 ||
      !validation.snapshots.latestSectorGeneratedAt ||
      Date.parse(validation.snapshots.latestSectorGeneratedAt) < repairStartedAt
    ) {
      issues.push("VALIDATION_SECTOR_SNAPSHOT_NOT_REBUILT");
    }
    if (
      validation.snapshots.themeRows === 0 ||
      !validation.snapshots.latestThemeGeneratedAt ||
      Date.parse(validation.snapshots.latestThemeGeneratedAt) < repairStartedAt
    ) {
      issues.push("VALIDATION_THEME_SNAPSHOT_NOT_REBUILT");
    }
  }
  return issues;
}