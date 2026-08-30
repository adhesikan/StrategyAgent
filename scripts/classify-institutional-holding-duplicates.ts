#!/usr/bin/env tsx
/**
 * Read-only Railway diagnostic for institutional holding identity.
 *
 * This command executes SELECT statements only. It never mutates holdings,
 * mappings, aggregates, signals, ingestion state, or feature flags.
 */

import { sql } from "drizzle-orm";
import { db } from "../server/db";
import {
  CANONICAL_SOURCE_HOLDING_IDENTITY,
  CURRENT_HOLDING_DUPLICATE_KEY,
  OMITTED_MATERIAL_HOLDING_FIELDS,
} from "../server/services/institutional/holding-duplicate-classifier";

const TARGETS = [
  { symbol: "AAPL", cusip: "037833100" },
  { symbol: "NVDA", cusip: "67066G104" },
  { symbol: "MSFT", cusip: "594918104" },
  { symbol: "COST", cusip: "22160K105" },
] as const;

function rowsOf(result: unknown): any[] {
  const candidate = result as { rows?: any[] };
  return candidate.rows ?? (Array.isArray(result) ? result : []);
}

function print(title: string, value: unknown): void {
  console.log(`\n${title}:`);
  console.log(JSON.stringify(value, null, 2));
}

function assertRailwayDatabaseRuntime(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_RUNTIME_REJECTED:DATABASE_URL_REQUIRED");
  }
  if (process.env.EXTERNAL_DATABASE_URL) {
    throw new Error("DATABASE_RUNTIME_REJECTED:EXTERNAL_DATABASE_URL_FORBIDDEN");
  }
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== "production") {
    throw new Error("DATABASE_RUNTIME_REJECTED:RAILWAY_ENVIRONMENT_IS_NOT_PRODUCTION");
  }
}

const duplicateGroupStats = sql`
  WITH group_stats AS (
    SELECT
      accession_number,
      cusip,
      class_title,
      COALESCE(put_call, '') AS put_call_key,
      COUNT(*)::int AS row_count,
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
      COUNT(DISTINCT ROW(filer_cik, period_of_report, filing_date))::int AS filing_context_variants
    FROM institutional_13f_holdings
    GROUP BY accession_number, cusip, class_title, COALESCE(put_call, '')
    HAVING COUNT(*) > 1
  ),
  classified AS (
    SELECT
      *,
      (
        (shares_type_variants > 1)::int +
        (discretion_variants > 1)::int +
        (other_manager_variants > 1)::int +
        (voting_variants > 1)::int +
        (amount_variants > 1)::int +
        (issuer_figi_variants > 1)::int +
        (filing_context_variants > 1)::int
      ) AS changed_dimension_count
    FROM group_stats
  )
`;

async function main(): Promise<void> {
  assertRailwayDatabaseRuntime();

  console.log("\n=== Institutional Holding Duplicate Classification ===");
  console.log("READ-ONLY: SELECT statements only; production data is unchanged.");

  const identityResult = await db.execute(sql`
    SELECT
      current_database() AS database,
      current_user AS database_user,
      current_schema() AS schema,
      ${process.env.RAILWAY_ENVIRONMENT_NAME}::text AS railway_environment,
      (
        SELECT indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'institutional_13f_holdings'
          AND indexname = 'idx_13f_holdings_unique'
      ) AS current_unique_index
  `);
  print("DATABASE AND IDENTITY MODEL", {
    ...rowsOf(identityResult)[0],
    currentDuplicateKey: CURRENT_HOLDING_DUPLICATE_KEY,
    omittedMaterialFields: OMITTED_MATERIAL_HOLDING_FIELDS,
    canonicalSourceIdentity: CANONICAL_SOURCE_HOLDING_IDENTITY,
    sourceInfoTableSkPersisted: false,
    nullUniquenessWarning:
      "PostgreSQL unique indexes treat NULL put_call values as distinct unless NULLS NOT DISTINCT is declared.",
  });

  const categoryResult = await db.execute(sql`
    ${duplicateGroupStats}
    SELECT
      CASE
        WHEN material_variant_count = 1
          THEN 'IDENTICAL_STORED_MATERIAL_SOURCE_IDENTITY_UNRESOLVED'
        WHEN changed_dimension_count > 1 THEN 'MULTIPLE_MATERIAL_DIFFERENCES'
        WHEN shares_type_variants > 1 THEN 'MATERIALLY_DISTINCT_SHARE_PRN_TYPE'
        WHEN discretion_variants > 1 THEN 'MATERIALLY_DISTINCT_INVESTMENT_DISCRETION'
        WHEN other_manager_variants > 1 THEN 'MATERIALLY_DISTINCT_OTHER_MANAGER'
        WHEN voting_variants > 1 THEN 'MATERIALLY_DISTINCT_VOTING_AUTHORITY'
        WHEN amount_variants > 1 THEN 'MATERIALLY_DISTINCT_REPORTED_AMOUNT'
        WHEN issuer_figi_variants > 1 THEN 'MATERIALLY_DISTINCT_ISSUER_OR_FIGI'
        WHEN filing_context_variants > 1 THEN 'MATERIALLY_DISTINCT_FILING_CONTEXT'
        ELSE 'UNCLASSIFIED'
      END AS category,
      COUNT(*)::int AS group_count,
      SUM(row_count)::int AS involved_rows,
      SUM(row_count - 1)::int AS excess_rows_if_collapsed
    FROM classified
    GROUP BY category
    ORDER BY group_count DESC, category
  `);
  const categories = rowsOf(categoryResult);
  print("CURRENT DUPLICATE GROUP CLASSIFICATION", categories);

  const reconciliationResult = await db.execute(sql`
    ${duplicateGroupStats}
    SELECT
      COUNT(*)::int AS current_duplicate_groups,
      SUM(row_count)::int AS involved_rows,
      SUM(row_count - 1)::int AS rows_beyond_one_per_current_key,
      COUNT(*) FILTER (WHERE material_variant_count = 1)::int
        AS source_identity_unresolved_identical_groups,
      COUNT(*) FILTER (WHERE material_variant_count > 1)::int AS materially_distinct_groups,
      SUM(row_count - 1) FILTER (WHERE material_variant_count = 1)::int
        AS conditionally_redundant_rows_if_source_duplicates,
      SUM(row_count - 1) FILTER (WHERE material_variant_count > 1)::int
        AS materially_distinct_rows_beyond_one_per_current_key
    FROM classified
  `);
  print("CLASSIFICATION RECONCILIATION", {
    ...rowsOf(reconciliationResult)[0],
    exactSourceDuplicateCount: "UNDETERMINABLE_WITHOUT_INFOTABLE_SK",
  });

  const adjacentResult = await db.execute(sql`
    WITH accession_cusip AS (
      SELECT
        accession_number,
        cusip,
        COUNT(*)::int AS row_count,
        COUNT(DISTINCT class_title)::int AS class_variants,
        COUNT(DISTINCT COALESCE(put_call, '<EQUITY>'))::int AS position_type_variants
      FROM institutional_13f_holdings
      GROUP BY accession_number, cusip
    )
    SELECT
      COUNT(*) FILTER (WHERE class_variants > 1)::int AS groups_with_distinct_class,
      COUNT(*) FILTER (WHERE position_type_variants > 1)::int AS groups_with_equity_put_call_distinctions,
      COUNT(*) FILTER (WHERE class_variants > 1 OR position_type_variants > 1)::int
        AS groups_correctly_separated_by_current_key,
      (SELECT COUNT(DISTINCT cusip)::int FROM institutional_13f_holdings) AS distinct_cusips,
      (SELECT COUNT(*)::int FROM (
        SELECT cusip
        FROM institutional_13f_holdings
        GROUP BY cusip
        HAVING COUNT(DISTINCT accession_number) > 1
      ) cross_filing) AS cusips_across_multiple_filings,
      (SELECT COUNT(*)::int FROM (
        SELECT cusip
        FROM institutional_13f_holdings
        GROUP BY cusip
        HAVING COUNT(DISTINCT filer_cik) > 1
      ) cross_manager) AS cusips_across_multiple_managers,
      (SELECT COUNT(*)::int FROM (
        SELECT cusip
        FROM institutional_13f_holdings
        GROUP BY cusip
        HAVING COUNT(DISTINCT period_of_report) > 1
      ) cross_quarter) AS cusips_across_multiple_quarters
    FROM accession_cusip
  `);
  print("LEGITIMATE SEPARATE-ROW CONTEXT", rowsOf(adjacentResult)[0]);

  const amendmentResult = await db.execute(sql`
    ${duplicateGroupStats},
    duplicate_accessions AS (
      SELECT DISTINCT accession_number FROM classified
    )
    SELECT
      COUNT(DISTINCT f.accession_number)::int AS filings_with_current_duplicate_groups,
      COUNT(DISTINCT f.accession_number) FILTER (WHERE f.is_effective = TRUE)::int
        AS effective_filings_with_groups,
      COUNT(DISTINCT f.accession_number) FILTER (WHERE f.is_effective = FALSE)::int
        AS superseded_filings_with_groups,
      COUNT(DISTINCT f.accession_number) FILTER (WHERE f.amendment_flag = TRUE)::int
        AS amendment_filings_with_groups,
      COUNT(DISTINCT f.accession_number) FILTER (
        WHERE f.amendment_flag = TRUE AND f.is_effective = TRUE
      )::int AS effective_amendment_filings_with_groups
    FROM duplicate_accessions d
    INNER JOIN institutional_13f_filings f
      ON f.accession_number = d.accession_number
  `);
  print("AMENDMENT AND EFFECTIVENESS CONTEXT", rowsOf(amendmentResult)[0]);

  const exactSamplesResult = await db.execute(sql`
    ${duplicateGroupStats}
    SELECT
      RIGHT(h.accession_number, 8) AS accession_suffix,
      LEFT(MD5(h.filer_cik), 10) AS manager_hash,
      h.cusip,
      h.issuer_name,
      h.class_title,
      COALESCE(h.put_call, 'EQUITY') AS position_type,
      h.shares_prn_type,
      h.investment_discretion,
      h.other_manager,
      h.reported_shares,
      h.reported_value,
      h.voting_sole,
      h.voting_shared,
      h.voting_none,
      c.row_count,
      f.is_effective,
      f.amendment_flag
    FROM classified c
    CROSS JOIN LATERAL (
      SELECT *
      FROM institutional_13f_holdings sample
      WHERE sample.accession_number = c.accession_number
        AND sample.cusip = c.cusip
        AND sample.class_title = c.class_title
        AND COALESCE(sample.put_call, '') = c.put_call_key
      ORDER BY sample.id
      LIMIT 1
    ) h
    INNER JOIN institutional_13f_filings f
      ON f.accession_number = h.accession_number
    WHERE c.material_variant_count = 1
    ORDER BY c.row_count DESC, h.cusip, h.accession_number
    LIMIT 10
  `);
  print(
    "SANITIZED IDENTICAL-STORED-MATERIAL SAMPLES — SOURCE IDENTITY UNRESOLVED (MAX 10 GROUPS)",
    rowsOf(exactSamplesResult),
  );

  const putCallSamplesResult = await db.execute(sql`
    SELECT
      RIGHT(h.accession_number, 8) AS accession_suffix,
      LEFT(MD5(h.filer_cik), 10) AS manager_hash,
      h.cusip,
      MIN(h.issuer_name) AS issuer_name,
      ARRAY_AGG(DISTINCT COALESCE(h.put_call, 'EQUITY') ORDER BY COALESCE(h.put_call, 'EQUITY'))
        AS position_types,
      COUNT(*)::int AS row_count
    FROM institutional_13f_holdings h
    GROUP BY h.accession_number, h.filer_cik, h.cusip
    HAVING COUNT(DISTINCT COALESCE(h.put_call, '<EQUITY>')) > 1
    ORDER BY row_count DESC, h.cusip
    LIMIT 10
  `);
  print("SANITIZED EQUITY/PUT/CALL DISTINCTION SAMPLES (MAX 10 GROUPS)", rowsOf(putCallSamplesResult));

  const materialSamplesResult = await db.execute(sql`
    ${duplicateGroupStats}
    SELECT
      RIGHT(c.accession_number, 8) AS accession_suffix,
      c.cusip,
      c.class_title,
      COALESCE(NULLIF(c.put_call_key, ''), 'EQUITY') AS position_type,
      c.row_count,
      c.changed_dimension_count,
      variants.samples AS representative_variants,
      f.is_effective,
      f.amendment_flag
    FROM classified c
    CROSS JOIN LATERAL (
      SELECT JSONB_AGG(sample.payload ORDER BY sample.payload::text) AS samples
      FROM (
        SELECT DISTINCT JSONB_BUILD_OBJECT(
          'managerHash', LEFT(MD5(h.filer_cik), 10),
          'issuerName', h.issuer_name,
          'figi', h.figi,
          'sharesPrnType', h.shares_prn_type,
          'investmentDiscretion', h.investment_discretion,
          'otherManager', h.other_manager,
          'reportedShares', h.reported_shares,
          'reportedValue', h.reported_value,
          'votingSole', h.voting_sole,
          'votingShared', h.voting_shared,
          'votingNone', h.voting_none
        ) AS payload
        FROM institutional_13f_holdings h
        WHERE h.accession_number = c.accession_number
          AND h.cusip = c.cusip
          AND h.class_title = c.class_title
          AND COALESCE(h.put_call, '') = c.put_call_key
        LIMIT 5
      ) sample
    ) variants
    INNER JOIN institutional_13f_filings f
      ON f.accession_number = c.accession_number
    WHERE c.material_variant_count > 1
    ORDER BY c.row_count DESC, c.cusip, c.accession_number
    LIMIT 10
  `);
  print("SANITIZED MATERIAL-DIFFERENCE SAMPLES (MAX 10 GROUPS)", rowsOf(materialSamplesResult));

  const targetCusips = TARGETS.map((target) => target.cusip);
  const targetResult = await db.execute(sql`
    ${duplicateGroupStats},
    target_groups AS (
      SELECT c.*
      FROM classified c
      INNER JOIN institutional_13f_filings f
        ON f.accession_number = c.accession_number
       AND f.is_effective = TRUE
      WHERE c.cusip IN (${sql.join(targetCusips.map((cusip) => sql`${cusip}`), sql`, `)})
    ),
    target_group_summary AS (
      SELECT
        cusip,
        COUNT(*)::int AS duplicate_groups,
        SUM(row_count)::int AS rows_in_duplicate_groups,
        COUNT(*) FILTER (WHERE material_variant_count = 1)::int
          AS source_identity_unresolved_identical_groups,
        COUNT(*) FILTER (WHERE material_variant_count > 1)::int AS materially_distinct_groups
      FROM target_groups
      GROUP BY cusip
    ),
    target_conditional_common_impact AS (
      SELECT
        c.cusip,
        SUM(c.row_count - 1)::int AS conditionally_redundant_common_rows,
        SUM((c.row_count - 1) * representative.reported_shares)::bigint
          AS conditionally_redundant_common_shares_if_source_duplicates
      FROM target_groups c
      CROSS JOIN LATERAL (
        SELECT h.reported_shares
        FROM institutional_13f_holdings h
        WHERE h.accession_number = c.accession_number
          AND h.cusip = c.cusip
          AND h.class_title = c.class_title
          AND COALESCE(h.put_call, '') = c.put_call_key
          AND h.put_call IS NULL
          AND h.shares_prn_type IS DISTINCT FROM 'PRN'
        LIMIT 1
      ) representative
      WHERE c.material_variant_count = 1
      GROUP BY c.cusip
    )
    SELECT
      h.cusip,
      COUNT(*) FILTER (WHERE f.is_effective = TRUE)::int AS effective_holding_rows,
      COUNT(*) FILTER (
        WHERE f.is_effective = TRUE
          AND h.put_call IS NULL
          AND h.shares_prn_type IS DISTINCT FROM 'PRN'
      )::int AS effective_common_equity_rows,
      COALESCE(SUM(h.reported_shares) FILTER (
        WHERE f.is_effective = TRUE
          AND h.put_call IS NULL
          AND h.shares_prn_type IS DISTINCT FROM 'PRN'
      ), 0)::bigint AS effective_common_equity_shares,
      COALESCE(MAX(s.duplicate_groups), 0)::int AS duplicate_groups,
      COALESCE(MAX(s.rows_in_duplicate_groups), 0)::int AS rows_in_duplicate_groups,
      COALESCE(MAX(s.source_identity_unresolved_identical_groups), 0)::int
        AS source_identity_unresolved_identical_groups,
      COALESCE(MAX(s.materially_distinct_groups), 0)::int AS materially_distinct_groups,
      COALESCE(MAX(i.conditionally_redundant_common_rows), 0)::int
        AS conditionally_redundant_common_rows,
      COALESCE(MAX(i.conditionally_redundant_common_shares_if_source_duplicates), 0)::bigint
        AS conditionally_redundant_common_shares_if_source_duplicates,
      COUNT(DISTINCT h.issuer_name)::int AS issuer_variants,
      COUNT(DISTINCT h.class_title)::int AS class_variants,
      COUNT(*) FILTER (WHERE f.is_effective = TRUE AND h.put_call IS NOT NULL)::int AS option_rows,
      COUNT(*) FILTER (WHERE f.is_effective = TRUE AND h.shares_prn_type = 'PRN')::int AS principal_rows
    FROM institutional_13f_holdings h
    INNER JOIN institutional_13f_filings f
      ON f.accession_number = h.accession_number
    LEFT JOIN target_group_summary s ON s.cusip = h.cusip
    LEFT JOIN target_conditional_common_impact i ON i.cusip = h.cusip
    WHERE h.cusip IN (${sql.join(targetCusips.map((cusip) => sql`${cusip}`), sql`, `)})
    GROUP BY h.cusip
    ORDER BY h.cusip
  `);
  const targetByCusip = new Map(rowsOf(targetResult).map((row) => [row.cusip, row]));
  print("AAPL/NVDA/MSFT/COST DUPLICATE AND AGGREGATE IMPACT", TARGETS.map((target) => ({
    symbol: target.symbol,
    cusip: target.cusip,
    ...(targetByCusip.get(target.cusip) ?? {}),
    mappingAmbiguity:
      "CUSIP mapping itself is unambiguous; option/PRN rows remain excluded by aggregate eligibility.",
    aggregateRisk:
      "Identical stored common-equity rows are summed, but the reported conditional amount is an overcount only if source duplication is later proven.",
  })));

  console.log("\nROOT-CAUSE INTERPRETATION RULES:");
  console.log("  DUPLICATE_CHECK_FALSE_POSITIVE: materially_distinct_groups > 0.");
  console.log("  PARSER_DUPLICATION: cannot be proven from stored rows because INFOTABLE_SK was discarded.");
  console.log("  INGESTION_DUPLICATION: identical-material groups may indicate it, but source identity is required to prove it.");
  console.log("  AMENDMENT_HANDLING_PROBLEM: supported only if effective/superseded filing state is inconsistent.");
  console.log("  DATABASE_DUPLICATION: repeated identical-material rows exist physically; source redundancy remains unresolved.");
  console.log("\nNO-GO: do not run the production repair until this output is reviewed.");
  console.log("=== Classification complete — production data unchanged ===\n");
}

if (!process.env.VITEST) {
  main().catch((error: any) => {
    console.error(`[institutional-duplicate-classifier] ERROR: ${String(error?.message ?? error).slice(0, 500)}`);
    process.exit(1);
  });
}
