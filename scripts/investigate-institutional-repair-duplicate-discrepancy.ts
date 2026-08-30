#!/usr/bin/env tsx
/**
 * Read-only investigation for the difference between:
 *   1. coarse-key classification, and
 *   2. repair-scope repeated exact-material groups.
 *
 * This command executes SELECT statements only. It does not modify production
 * data, deduplicate holdings, or change the repair gate.
 */

import { sql } from "drizzle-orm";

const TARGETS = [
  { symbol: "AAPL", cusip: "037833100" },
  { symbol: "NVDA", cusip: "67066G104" },
  { symbol: "MSFT", cusip: "594918104" },
  { symbol: "COST", cusip: "22160K105" },
] as const;

const COARSE_KEY_FIELDS = [
  "accession_number",
  "cusip",
  "class_title",
  "COALESCE(put_call, '')",
] as const;

const REPAIR_EXACT_MATERIAL_FIELDS = [
  "accession_number",
  "cusip",
  "class_title",
  "issuer_name",
  "figi",
  "reported_value",
  "reported_shares",
  "shares_prn_type",
  "investment_discretion",
  "other_manager",
  "voting_sole",
  "voting_shared",
  "voting_none",
  "filer_cik",
  "period_of_report",
  "filing_date",
] as const;

function rowsOf(result: unknown): any[] {
  const candidate = result as { rows?: any[] };
  return candidate.rows ?? (Array.isArray(result) ? result : []);
}

function print(title: string, value: unknown): void {
  console.log(`\n${title}:`);
  console.log(JSON.stringify(value, null, 2));
}

export function parseExpectedDatabase(argv: string[]): string | null {
  const index = argv.indexOf("--database-name");
  const value = index >= 0 ? argv[index + 1]?.trim() : "";
  return value || null;
}

export function validateDiscrepancyRuntime(env: NodeJS.ProcessEnv): string[] {
  const issues: string[] = [];
  if (!env.DATABASE_URL) issues.push("DATABASE_URL_REQUIRED");
  if (env.EXTERNAL_DATABASE_URL) issues.push("EXTERNAL_DATABASE_URL_FORBIDDEN");
  if (env.RAILWAY_ENVIRONMENT_NAME !== "production") {
    issues.push("RAILWAY_ENVIRONMENT_IS_NOT_PRODUCTION");
  }
  if (!env.RAILWAY_PROJECT_ID) issues.push("RAILWAY_PROJECT_ID_REQUIRED");
  if (!env.RAILWAY_SERVICE_ID) issues.push("RAILWAY_SERVICE_ID_REQUIRED");
  if (!env.RAILWAY_ENVIRONMENT_ID) issues.push("RAILWAY_ENVIRONMENT_ID_REQUIRED");
  if (env.DATABASE_URL) {
    try {
      const url = new URL(env.DATABASE_URL);
      const railwayHost =
        url.hostname.endsWith(".railway.internal") ||
        url.hostname.endsWith(".rlwy.net");
      if (!["postgres:", "postgresql:"].includes(url.protocol) || !railwayHost) {
        issues.push("DATABASE_URL_IS_NOT_A_RAILWAY_POSTGRES_ENDPOINT");
      }
    } catch {
      issues.push("DATABASE_URL_INVALID");
    }
  }
  return issues;
}

async function main(): Promise<void> {
  const runtimeIssues = validateDiscrepancyRuntime(process.env);
  if (runtimeIssues.length > 0) {
    throw new Error(`DATABASE_RUNTIME_REJECTED:${runtimeIssues.join(",")}`);
  }
  const expectedDatabase = parseExpectedDatabase(process.argv.slice(2));
  if (!expectedDatabase) {
    throw new Error("DATABASE_RUNTIME_REJECTED:EXPECTED_DATABASE_NAME_REQUIRED");
  }
  const { db } = await import("../server/db");
  const identityResult = await db.execute(sql`
    SELECT
      current_database() AS database,
      current_user AS database_user,
      current_schema() AS schema
  `);
  const identity = rowsOf(identityResult)[0] ?? {};
  if (identity.database !== expectedDatabase) {
    throw new Error("DATABASE_RUNTIME_REJECTED:DATABASE_IDENTITY_MISMATCH");
  }

  const targetCusips = TARGETS.map((target) => target.cusip);
  const result = await db.execute(sql`
    WITH effective_holdings AS (
      SELECT
        h.*,
        f.filing_type,
        f.amendment_flag,
        f.amendment_number,
        f.amendment_type,
        f.is_effective
      FROM institutional_13f_holdings h
      INNER JOIN institutional_13f_filings f
        ON f.accession_number = h.accession_number
       AND f.is_effective = TRUE
    ),
    repair_exact_material_groups AS (
      SELECT
        accession_number,
        cusip,
        class_title,
        issuer_name,
        figi,
        reported_value,
        reported_shares,
        shares_prn_type,
        investment_discretion,
        other_manager,
        voting_sole,
        voting_shared,
        voting_none,
        filer_cik,
        period_of_report,
        filing_date,
        COUNT(*)::int AS physical_rows
      FROM effective_holdings
      WHERE cusip IN (${sql.join(targetCusips.map((cusip) => sql`${cusip}`), sql`, `)})
        AND put_call IS NULL
        AND shares_prn_type IS DISTINCT FROM 'PRN'
        AND reported_shares > 0
      GROUP BY
        accession_number,
        cusip,
        class_title,
        issuer_name,
        figi,
        reported_value,
        reported_shares,
        shares_prn_type,
        investment_discretion,
        other_manager,
        voting_sole,
        voting_shared,
        voting_none,
        filer_cik,
        period_of_report,
        filing_date
      HAVING COUNT(*) > 1
    ),
    classifier_parent_groups AS (
      SELECT
        accession_number,
        cusip,
        class_title,
        COALESCE(put_call, '') AS put_call_key,
        COUNT(DISTINCT ROW(
          issuer_name,
          figi,
          reported_value,
          reported_shares,
          shares_prn_type,
          investment_discretion,
          other_manager,
          voting_sole,
          voting_shared,
          voting_none,
          filer_cik,
          period_of_report,
          filing_date
        ))::int AS material_variant_count,
        COUNT(DISTINCT COALESCE(shares_prn_type, '<NULL>'))::int AS shares_type_variants,
        COUNT(DISTINCT COALESCE(investment_discretion, '<NULL>'))::int AS discretion_variants,
        COUNT(DISTINCT COALESCE(other_manager, '<NULL>'))::int AS other_manager_variants,
        COUNT(DISTINCT ROW(voting_sole, voting_shared, voting_none))::int AS voting_variants,
        COUNT(DISTINCT ROW(reported_value, reported_shares))::int AS amount_variants,
        COUNT(DISTINCT ROW(issuer_name, figi))::int AS issuer_figi_variants,
        COUNT(DISTINCT ROW(filer_cik, period_of_report, filing_date))::int
          AS filing_context_variants
      FROM institutional_13f_holdings
      WHERE cusip IN (${sql.join(targetCusips.map((cusip) => sql`${cusip}`), sql`, `)})
      GROUP BY accession_number, cusip, class_title, COALESCE(put_call, '')
      HAVING COUNT(*) > 1
    )
    SELECT
      g.accession_number,
      g.cusip,
      g.class_title,
      NULL::text AS put_call,
      g.issuer_name,
      g.figi,
      g.reported_value,
      g.reported_shares,
      g.shares_prn_type,
      g.investment_discretion,
      g.other_manager,
      g.voting_sole,
      g.voting_shared,
      g.voting_none,
      LEFT(MD5(g.filer_cik), 10) AS manager_hash,
      f.filer_name,
      g.period_of_report,
      g.filing_date,
      f.filing_type,
      f.amendment_flag,
      f.amendment_number,
      f.amendment_type,
      f.is_effective,
      g.physical_rows,
      p.material_variant_count AS parent_material_variant_count,
      p.shares_type_variants,
      p.discretion_variants,
      p.other_manager_variants,
      p.voting_variants,
      p.amount_variants,
      p.issuer_figi_variants,
      p.filing_context_variants,
      (g.reported_shares * g.physical_rows) AS included_common_equity_shares,
      CASE
        WHEN g.reported_value IS NULL THEN NULL
        ELSE g.reported_value * g.physical_rows
      END AS included_reported_value,
      (g.physical_rows - 1)::int AS conditional_redundant_rows,
      (g.reported_shares * (g.physical_rows - 1)) AS conditional_redundant_shares,
      CASE
        WHEN g.reported_value IS NULL THEN NULL
        ELSE g.reported_value * (g.physical_rows - 1)
      END AS conditional_redundant_reported_value
    FROM repair_exact_material_groups g
    INNER JOIN institutional_13f_filings f
      ON f.accession_number = g.accession_number
    INNER JOIN classifier_parent_groups p
      ON p.accession_number = g.accession_number
     AND p.cusip = g.cusip
     AND p.class_title = g.class_title
     AND p.put_call_key = ''
    ORDER BY g.cusip, g.accession_number, g.class_title, g.reported_shares
  `);

  const rawGroups = rowsOf(result);
  const groups = rawGroups.map((row) => {
    const differingParentDimensions = [
      ...(Number(row.shares_type_variants) > 1 ? ["shares_prn_type"] : []),
      ...(Number(row.discretion_variants) > 1 ? ["investment_discretion"] : []),
      ...(Number(row.other_manager_variants) > 1 ? ["other_manager"] : []),
      ...(Number(row.voting_variants) > 1 ? ["voting_authority"] : []),
      ...(Number(row.amount_variants) > 1 ? ["reported_shares_or_value"] : []),
      ...(Number(row.issuer_figi_variants) > 1 ? ["issuer_name_or_figi"] : []),
      ...(Number(row.filing_context_variants) > 1 ? ["filing_context"] : []),
    ];
    return {
    symbol: TARGETS.find((target) => target.cusip === row.cusip)?.symbol ?? "UNKNOWN",
    accessionSuffix: String(row.accession_number).slice(-8),
    managerHash: row.manager_hash ? String(row.manager_hash) : null,
    filerName: row.filer_name ? String(row.filer_name) : null,
    cusip: row.cusip,
    issuerName: row.issuer_name,
    classTitle: row.class_title,
    putCall: row.put_call,
    sharesPrnType: row.shares_prn_type,
    reportedShares: row.reported_shares,
    reportedValue: row.reported_value,
    investmentDiscretion: row.investment_discretion,
    otherManager: row.other_manager,
    voting: {
      sole: row.voting_sole,
      shared: row.voting_shared,
      none: row.voting_none,
    },
    periodOfReport: row.period_of_report,
    filingDate: row.filing_date,
    filingType: row.filing_type,
    amendment: {
      flag: row.amendment_flag,
      number: row.amendment_number,
      type: row.amendment_type,
      effective: row.is_effective,
    },
    physicalRows: row.physical_rows,
    includedCommonEquityShares: row.included_common_equity_shares,
    includedReportedValue: row.included_reported_value,
    conditionalRedundantRows: row.conditional_redundant_rows,
    conditionalRedundantShares: row.conditional_redundant_shares,
    conditionalRedundantReportedValue: row.conditional_redundant_reported_value,
    repairClassification: "B — MATERIALLY_IDENTICAL_STORED_FIELDS_SOURCE_IDENTITY_UNRESOLVED",
    classifierParentEvidence: {
      materialVariantCount: row.parent_material_variant_count,
      differingDimensions: differingParentDimensions,
      earlierClassifierCategory:
        Number(row.parent_material_variant_count) > 1
          ? "MATERIALLY_DISTINCT_PARENT_COARSE_GROUP"
          : "SOURCE_IDENTITY_UNRESOLVED_PARENT_COARSE_GROUP",
    },
  };
  });

  const bySymbol = new Map(TARGETS.map((target) => [target.symbol, [] as any[]]));
  for (const group of groups) bySymbol.get(group.symbol)?.push(group);

  print("DEFINITIONS", {
    earlierClassifier: {
      coarseKey: COARSE_KEY_FIELDS,
      materialVariantFields: REPAIR_EXACT_MATERIAL_FIELDS.slice(3),
      behavior:
        "Groups by coarse key first; any material variant makes the whole coarse group materially distinct, so nested repeated exact variants are not counted as unresolved.",
    },
    repairGuard: {
      effectiveJoin: "institutional_13f_filings.is_effective = TRUE",
      targetCusips,
      eligibility: [
        "institutional_13f_filings.is_effective = TRUE",
        "CUSIP is one of AAPL/NVDA/MSFT/COST",
        "put_call IS NULL",
        "shares_prn_type IS DISTINCT FROM 'PRN'",
        "reported_shares > 0",
        "mapping_status is not filtered because the planned mapping stage promotes these target rows before aggregation",
      ],
      exactMaterialGroupFields: REPAIR_EXACT_MATERIAL_FIELDS,
      putCallDefinition:
        "put_call is an eligibility filter fixed to NULL, not a GROUP BY/equality field in the repair guard",
      behavior:
        "Groups target effective eligible rows by every persisted material field and counts groups with physical_rows > 1.",
    },
    sourceIdentity: "INFOTABLE_SK is not persisted; exact SEC source duplication is not provable.",
  });
  print("REPAIR-SCOPE EXACT-MATERIAL GROUP COUNT", {
    total: groups.length,
    expectedFromFreshDryRun: 30,
    bySymbol: Object.fromEntries(TARGETS.map((target) => [target.symbol, bySymbol.get(target.symbol)?.length ?? 0])),
  });
  for (const target of TARGETS) {
    print(`${target.symbol} GROUP ANALYSIS`, bySymbol.get(target.symbol) ?? []);
  }

  const totals = TARGETS.map((target) => {
    const targetGroups = bySymbol.get(target.symbol) ?? [];
    const sum = (field: "conditionalRedundantRows" | "conditionalRedundantShares" | "conditionalRedundantReportedValue") =>
      targetGroups.reduce((total, group) => total + Number(group[field] ?? 0), 0);
    return {
      symbol: target.symbol,
      unresolvedGroups: targetGroups.length,
      physicalRows: targetGroups.reduce((total, group) => total + Number(group.physicalRows ?? 0), 0),
      commonEquitySharesIncluded: targetGroups.reduce(
        (total, group) => total + Number(group.includedCommonEquityShares ?? 0),
        0,
      ),
      reportedValueIncluded: targetGroups.reduce(
        (total, group) => total + Number(group.includedReportedValue ?? 0),
        0,
      ),
      conditionalRedundantRowsIfSourceDuplicates: sum("conditionalRedundantRows"),
      conditionalRedundantSharesIfSourceDuplicates: sum("conditionalRedundantShares"),
      conditionalRedundantReportedValueIfSourceDuplicates: sum("conditionalRedundantReportedValue"),
    };
  });
  print("CONDITIONAL AGGREGATION IMPACT TOTALS", totals);
  const allNestedInMateriallyDistinctParents = groups.every(
    (group) => Number(group.classifierParentEvidence.materialVariantCount) > 1,
  );
  print("ROOT-CAUSE AND SAFETY DETERMINATION", {
    whyEarlierClassifierSaidZero:
      allNestedInMateriallyDistinctParents
        ? "Confirmed by parent evidence: every returned exact subgroup sits inside a coarse-key group with multiple material variants, so the non-nested classifier reports the parent as materially distinct and does not also report the nested exact subgroup."
        : "NOT FULLY EXPLAINED: at least one returned subgroup does not have a materially distinct classifier parent; review that group before drawing a conclusion.",
    whyRepairGuardSaidSixThirteenEleven:
      "Its target query is nested at exact persisted material-field granularity, so it finds repeated exact subgroups even when their surrounding coarse key also contains a legitimate material split.",
    groupClassification:
      "All returned groups satisfy the exact persisted-field equality and aggregate-eligibility filters; without INFOTABLE_SK they are category B, not proven parser, ingestion, or database duplication.",
    aggregationImpact:
      "The aggregation engine intentionally sums all eligible rows by filer. The reported redundant rows/shares/value are conditional maximums only if later source evidence proves those rows are duplicate source lines.",
    recommendedSafetyRule:
      groups.length > 0
        ? "C — source provenance is insufficient to safely perform this repair for every target with returned groups. Retain the current blocker and do not weaken or bypass it."
        : "No unresolved repair-scope groups were returned; reconcile this with the fresh dry-run before considering any safety-rule change.",
    productionApply: "NO-GO",
  });
  console.log("\nREAD-ONLY COMPLETE — production data unchanged.\n");
}

if (!process.env.VITEST) {
  main().catch((error: any) => {
    console.error(`[institutional-repair-discrepancy] ERROR: ${String(error?.message ?? error).slice(0, 500)}`);
    process.exit(1);
  });
}
